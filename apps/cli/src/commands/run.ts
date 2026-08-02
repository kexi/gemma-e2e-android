import type { Run } from "@gemma-e2e/core/schema";
import { parseCommand, rejectExtraOperands, requireOperand } from "../args.ts";
import { ApiError, ConnectionError, type CreateRunRequest } from "../client.ts";
import { type Context, printJson } from "../context.ts";
import { EXIT_ERROR, EXIT_OK, type ExitCode, exitCodeForStatus } from "../exit-codes.ts";
import { renderEvent, renderRun, renderRunList } from "../render.ts";
import { readSse, type RunEvent, toRunEvent } from "../sse.ts";
import { answerHelpOrVersion, helpText, PROGRAM, UsageError } from "../usage.ts";

/**
 * POST /api/runs answers 202 before the run exists in Firestore, so the first
 * look at it can legitimately 404. Long enough to cover a cold write, short
 * enough that a genuinely wrong id still fails promptly.
 */
const RUN_APPEAR_ATTEMPTS = 20;
const RUN_APPEAR_DELAY_MS = 300;
/**
 * `get` retries the same 404 but far less patiently. Not the watch budget: the
 * id there came from the POST this process just made, so waiting six seconds
 * for it is waiting on a write that is certainly coming, whereas an id typed at
 * a shell is as likely to be a typo, and a typo must not hang the terminal.
 * Three attempts still cover the pipeline case (`run start` piped into
 * `run get`) where the write lands a moment late.
 */
const RUN_APPEAR_ATTEMPTS_GET = 3;
/** Fallback cadence once the event stream has dropped without a verdict. */
const POLL_INTERVAL_MS = 2000;
/**
 * Ceiling on the polling fallback, ~30 minutes at the cadence above. A run is
 * bounded in steps (maxSteps) but not in wall-clock time, so there is no server
 * deadline to borrow; the figure is instead set well past how long a scenario's
 * worth of steps takes against a live emulator and LLM. Deliberately generous
 * rather than tight: giving up on a healthy slow run reports it as unresolved,
 * which is the worse of the two mistakes, and CI wanting a shorter leash
 * already has its own step timeout.
 */
const POLL_MAX_ATTEMPTS = 900;

export interface RunTiming {
  appearDelayMs: number;
  pollIntervalMs: number;
  sleep: (ms: number) => Promise<void>;
}

export const REAL_TIMING: RunTiming = {
  appearDelayMs: RUN_APPEAR_DELAY_MS,
  pollIntervalMs: POLL_INTERVAL_MS,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

const START_OPTIONS = {
  watch: { type: "boolean", short: "w" },
  prompt: { type: "string", short: "p" },
  title: { type: "string" },
  model: { type: "string" },
} as const;

export const RUN_HELP = helpText({
  usage: [`${PROGRAM} run COMMAND [ARG]...`],
  description: "Start runs and follow them to a verdict.",
  commands: [
    { flags: "start", description: "start a run from a scenario or a prompt" },
    { flags: "list", description: "list the most recent runs" },
    { flags: "get RUN_ID", description: "show one run and its steps" },
    { flags: "watch RUN_ID", description: "follow a run's timeline to its verdict" },
  ],
});

const SUBCOMMAND_HELP: Record<string, string> = {
  start: helpText({
    usage: [
      `${PROGRAM} run start [OPTION]... SCENARIO_ID`,
      `${PROGRAM} run start [OPTION]... --prompt TEXT`,
    ],
    description:
      "Start a run, either from a stored scenario or from a one-off prompt.\n\nA stored scenario carries its own title and model, so --title and --model\nbelong to --prompt alone and are refused alongside a scenario id.\n\nWithout --watch the run id is printed and the command returns immediately.\nWith it, the run is followed to its verdict and the exit status reports it.",
    options: [
      { flags: "-w, --watch", description: "follow the run and exit with its verdict" },
      { flags: "-p, --prompt=TEXT", description: "run this prompt instead of a scenario" },
      { flags: "    --title=TEXT", description: "title for the ad-hoc run (needs --prompt)" },
      { flags: "    --model=ID", description: "model for the ad-hoc run (needs --prompt)" },
    ],
  }),
  list: helpText({
    usage: [`${PROGRAM} run list [OPTION]...`],
    description: "List the most recent runs and their verdicts.",
  }),
  get: helpText({
    usage: [`${PROGRAM} run get [OPTION]... RUN_ID`],
    description: "Show one run: its verdict, its cases, and each case's steps.",
  }),
  watch: helpText({
    usage: [`${PROGRAM} run watch [OPTION]... RUN_ID`],
    description:
      "Follow a run's timeline to its verdict and exit with it.\n\nThe timeline is replayed from the start, so watching a run that has already\nfinished prints the whole thing.",
  }),
};

export async function runCommand(
  argv: string[],
  context: Context,
  subcommand: string | null,
  timing: RunTiming = REAL_TIMING,
): Promise<ExitCode> {
  const isMissing = subcommand === null;
  if (isMissing) {
    throw new UsageError("missing run subcommand", ["run"]);
  }

  const help = SUBCOMMAND_HELP[subcommand];
  const isKnown = help !== undefined;
  if (!isKnown) {
    throw new UsageError(`unknown run subcommand '${subcommand}'`, ["run"]);
  }

  const command = ["run", subcommand];
  const isStart = subcommand === "start";
  const parsed = parseCommand<{
    watch?: boolean;
    prompt?: string;
    title?: string;
    model?: string;
  }>(argv, isStart ? START_OPTIONS : {}, command);

  answerHelpOrVersion(parsed.flags, help);

  switch (subcommand) {
    case "start":
      rejectExtraOperands(parsed.operands, 1, command);
      return await startRun(context, parsed.operands[0], parsed.options, timing);
    case "list":
      rejectExtraOperands(parsed.operands, 0, command);
      return await listRuns(context);
    case "get":
      rejectExtraOperands(parsed.operands, 1, command);
      return await getRun(context, requireOperand(parsed.operands, "run id", command), timing);
    default:
      rejectExtraOperands(parsed.operands, 1, command);
      return await watchRun(context, requireOperand(parsed.operands, "run id", command), timing);
  }
}

async function startRun(
  context: Context,
  scenarioId: string | undefined,
  options: { watch?: boolean; prompt?: string; title?: string; model?: string },
  timing: RunTiming,
): Promise<ExitCode> {
  // "Was --prompt typed" and "is its value usable" are kept apart on purpose:
  // conflating them made `--prompt ""` read as no prompt at all, so it slipped
  // past the checks below and silently started whatever the scenario id said.
  const hasPrompt = options.prompt !== undefined;
  const hasScenario = scenarioId !== undefined;

  const hasNeither = !hasPrompt && !hasScenario;
  if (hasNeither) {
    throw new UsageError("missing scenario id (or --prompt)", ["run", "start"]);
  }
  const hasBoth = hasPrompt && hasScenario;
  if (hasBoth) {
    throw new UsageError("give either a scenario id or --prompt, not both", ["run", "start"]);
  }
  // Refused rather than sent: there is nothing for the agent to attempt, so the
  // run would burn a device and a model only to fail for want of an instruction.
  const isPromptEmpty = options.prompt === "";
  if (isPromptEmpty) {
    throw new UsageError("--prompt cannot be empty", ["run", "start"]);
  }

  // Refused rather than passed along: POST /api/runs reads title and model only
  // on the ad-hoc branch, so a scenario start would accept `--model bogus` and
  // silently run the scenario's own model instead. Dropping a flag the user
  // typed is worse than making them retype the command.
  const adHocOnly: string[] = [];
  if (options.title !== undefined) {
    adHocOnly.push("--title");
  }
  if (options.model !== undefined) {
    adHocOnly.push("--model");
  }
  const hasAdHocOnly = hasScenario && adHocOnly.length > 0;
  if (hasAdHocOnly) {
    throw new UsageError(`use ${adHocOnly.join(" and ")} with --prompt, not with a scenario id`, [
      "run",
      "start",
    ]);
  }

  const body: CreateRunRequest = hasPrompt
    ? {
        prompt: options.prompt as string,
        ...(options.title === undefined ? {} : { title: options.title }),
        ...(options.model === undefined ? {} : { model: options.model }),
      }
    : { scenarioId: scenarioId as string };

  const { runId } = await context.client.createRun(body);

  const isWatching = options.watch === true;
  if (!isWatching) {
    if (context.json) {
      printJson(context, { runId });
      return EXIT_OK;
    }
    context.out(runId);
    return EXIT_OK;
  }

  return await watchRun(context, runId, timing);
}

async function listRuns(context: Context): Promise<ExitCode> {
  const { runs } = await context.client.listRuns();

  if (context.json) {
    printJson(context, runs);
    return EXIT_OK;
  }

  context.out(renderRunList(runs, context.style));
  return EXIT_OK;
}

async function getRun(context: Context, runId: string, timing: RunTiming): Promise<ExitCode> {
  const { run } = await waitForRun(context, runId, timing, RUN_APPEAR_ATTEMPTS_GET);

  if (context.json) {
    printJson(context, run);
  } else {
    context.out(renderRun(run, context.style));
  }

  return exitCodeForStatus(run.status);
}

/**
 * Follows a run to its verdict.
 *
 * The stream is the fast path but not a guarantee: the server closes it on
 * `run_finished`, and any earlier close (a restart, a dropped connection) is
 * indistinguishable from that at the socket level. So a stream that ends
 * without a verdict falls through to polling rather than reporting success it
 * never saw. A stream that ends by *throwing* -- a socket reset mid-frame is
 * the same restart seen a moment earlier -- falls through the same way, since
 * refusing to poll exactly when the connection proved unreliable would give up
 * on the run in the one case the fallback exists for.
 *
 * Failing to *open* the stream falls through on the same terms: a restart that
 * lands a moment earlier refuses the connection or answers 502 instead of
 * cutting a live socket, and which side of that instant the CLI arrives on is
 * not something a user chose. The line between "wait for the server to come
 * back" and "this will never work" is the one isTransientPollFailure already
 * draws, so it is asked here too rather than restated -- a 404 from /events
 * still leaves as it came.
 *
 * The stream is drained to its close rather than broken out of on
 * `run_finished`: the timeline is replayed from the start, so a finished run
 * can deliver that frame with events still behind it, and breaking early would
 * print a verdict over a half-printed timeline. A server that then fails to
 * close is caught by pollToVerdict's ceiling.
 */
async function watchRun(context: Context, runId: string, timing: RunTiming): Promise<ExitCode> {
  await waitForRun(context, runId, timing, RUN_APPEAR_ATTEMPTS);

  const response = await openEvents(context, runId);
  const isOpen = response !== null;
  if (isOpen) {
    const finish = await streamEvents(context, response).catch(() => null);
    const sawVerdict = finish !== null;
    if (sawVerdict) {
      return exitCodeForStatus(finish.status);
    }
  }

  return await pollToVerdict(context, runId, timing);
}

/**
 * The event stream if it opened, null if the failure was the kind polling can
 * outlast. Anything else -- a 404 for a run that has been deleted, a 4xx that
 * will not become a 2xx on the next try -- is raised, since polling it would
 * only spend POLL_MAX_ATTEMPTS to reach the failure already in hand.
 */
async function openEvents(context: Context, runId: string): Promise<Response | null> {
  let response: Response;
  try {
    response = await context.client.fetch(`/api/runs/${encodeURIComponent(runId)}/events`);
  } catch (error) {
    if (isTransientPollFailure(error)) {
      return null;
    }
    throw error;
  }

  if (response.ok) {
    return response;
  }

  // Built before it is classified rather than after: isTransientPollFailure
  // reads a status off an ApiError, and handing it the same value the throw
  // would carry keeps one shape flowing through one judgement.
  const failure = new ApiError(response.status, `cannot watch run ${runId} (${response.status})`);
  if (isTransientPollFailure(failure)) {
    return null;
  }
  throw failure;
}

type RunFinished = Extract<RunEvent, { type: "run_finished" }>;

async function streamEvents(context: Context, response: Response): Promise<RunFinished | null> {
  let finish: RunFinished | null = null;

  for await (const message of readSse(response)) {
    const event = toRunEvent(message);
    const isParsed = event !== null;
    if (!isParsed) {
      continue;
    }

    const isFinish = event.type === "run_finished";
    if (isFinish) {
      finish = event;
    }

    if (context.json) {
      printJson(context, event);
      continue;
    }

    const line = renderEvent(event, context.style);
    const isShown = line !== null;
    if (isShown) {
      context.out(line);
    }
  }

  return finish;
}

/**
 * Waits for the run document to exist and answers with it. `POST /api/runs`
 * answers 202 and writes afterwards, so reading a run the CLI just started
 * would otherwise race the first write and report a 404 for a run that is about
 * to be fine. `attempts` is per caller because how long a wait is reasonable
 * depends on where the id came from -- see RUN_APPEAR_ATTEMPTS_GET.
 */
async function waitForRun(
  context: Context,
  runId: string,
  timing: RunTiming,
  attempts: number,
): Promise<{ run: Run }> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await context.client.getRun(runId);
    } catch (error) {
      const isMissing = error instanceof ApiError && error.status === 404;
      const canRetry = isMissing && attempt < attempts - 1;
      if (!canRetry) {
        throw error;
      }
      await timing.sleep(timing.appearDelayMs);
    }
  }
}

/**
 * A failed request that says nothing about the run, as opposed to one that says
 * the run is gone or the request was wrong. The single place that line is
 * drawn: openEvents asks it of the request that opens the stream and pollOnce
 * of each poll after one is abandoned, and the two must not drift, or a status
 * would decide the run's fate by which of them happened to meet it.
 *
 * Both land in the same weather, because the stream is only ever abandoned --
 * or refused at the outset -- when something has gone wrong with the connection
 * or the server: a refused connection while the dashboard restarts, a 502 from
 * a proxy ahead of it, a 503 while it comes back up. Treating those as answers
 * would make the fallback fail precisely when it is needed, so they cost an
 * attempt and nothing more.
 *
 * *Why not retry everything:* a 404 means the run was deleted and a 4xx means
 * this request will never succeed, so retrying either burns the whole
 * POLL_MAX_ATTEMPTS budget -- half an hour of a held terminal -- to arrive at
 * the failure that was already known on the first try. Those are raised as they
 * come.
 */
function isTransientPollFailure(error: unknown): boolean {
  const isApi = error instanceof ApiError;
  if (!isApi) {
    // A ConnectionError, i.e. nothing is listening yet. The server being down
    // is the restart this fallback was written for.
    return error instanceof ConnectionError;
  }
  return error.status >= 500;
}

/**
 * Fallback for a stream that died mid-run: ask until the run reaches a verdict,
 * and give up rather than poll forever. A run wedged in "running" -- an
 * executor killed between its last write and its verdict -- would otherwise
 * hold the terminal, or a CI job, until something outside kills it.
 *
 * Polls that fail transiently are spent attempts rather than the end of the
 * loop; see isTransientPollFailure for where that line is drawn.
 */
async function pollToVerdict(
  context: Context,
  runId: string,
  timing: RunTiming,
): Promise<ExitCode> {
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt += 1) {
    const run = await pollOnce(context, runId);
    const isResolved = run !== null && run.status !== "running";
    if (isResolved) {
      reportFinalStatus(context, run);
      return exitCodeForStatus(run.status);
    }
    await timing.sleep(timing.pollIntervalMs);
  }

  // Not a UsageError: nothing about the command was wrong, so the "Try --help"
  // hint would misdirect. Exit 2 all the same -- an unresolved run is "I could
  // not answer", never a passing one.
  context.err(`${PROGRAM}: run ${runId} is still running; gave up waiting for a verdict`);
  return EXIT_ERROR;
}

/** One poll: the run if the server answered with it, null if the failure was worth retrying. */
async function pollOnce(context: Context, runId: string): Promise<Run | null> {
  try {
    const { run } = await context.client.getRun(runId);
    return run;
  } catch (error) {
    if (isTransientPollFailure(error)) {
      return null;
    }
    throw error;
  }
}

function reportFinalStatus(context: Context, run: Run): void {
  const event: RunFinished = {
    type: "run_finished",
    runId: run.id,
    status: run.status,
    reason: run.verdictReason,
  };

  if (context.json) {
    printJson(context, event);
    return;
  }

  const line = renderEvent(event, context.style);
  const isShown = line !== null;
  if (isShown) {
    context.out(line);
  }
}
