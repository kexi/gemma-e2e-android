import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import type {
  Action,
  PersonaReview,
  CaseRun,
  CaseStatus,
  Run,
  RunStatus,
  Scenario,
  Step,
  TestCase,
  UiFormat,
} from "@gemma-e2e/core";
import {
  DEFAULT_UI_FORMAT,
  resolvePersonaReview,
  resolveModel,
  resolveTarget,
  resolveUiFormat,
  serializeForLlm,
  serializeUi,
  type UiRef,
} from "@gemma-e2e/core";
import { errorFields, type Logger, noopLogger } from "@gemma-e2e/logger";
import type { Driver, DriverSession, OpenDriver } from "./driver.ts";
import type { Clock, LlmFactory } from "./llm.ts";
import { recordCase } from "./recorder.ts";
import type { PersonaReviewer } from "./persona-review.ts";

export interface StoreLike {
  /**
   * Claims the run: it exists from here on, and it is now running.
   *
   * Deliberately not `createRun`. A run may already have a document — the
   * serial queue writes one as `queued` the moment it accepts the job, so the
   * id it hands back is fetchable before any device is touched — or it may not,
   * as when the CLI and the tests call `runScenario` directly and the run
   * begins the instant it is created. The runner must work either way, so it
   * asks for the transition it actually means rather than for a creation it
   * cannot promise is the first one.
   */
  beginRun(input: { id: string; scenarioId: string; title: string }): Promise<Run>;
  createCase(input: {
    runId: string;
    caseId: string;
    order: number;
    title: string;
    prompt: string;
    model: string;
    uiFormat?: UiFormat | undefined;
  }): Promise<CaseRun>;
  addStep(input: {
    runId: string;
    caseId: string;
    index: number;
    action: Action;
    uiText: string;
    screenshotPath?: string | null | undefined;
    note?: string | null | undefined;
    personaReview?: PersonaReview | null | undefined;
  }): Promise<Step>;
  finishCase(
    runId: string,
    caseId: string,
    input: {
      /**
       * A case has no waiting state, so `queued` is not offered here. The narrow
       * type is what stops a run-level status being written to a case document
       * where nothing would ever move it on again.
       */
      status: CaseStatus;
      verdictReason?: string | null;
      videoPath?: string | null | undefined;
    },
  ): Promise<void>;
  finishRun(
    runId: string,
    input: { status: RunStatus; verdictReason?: string | null },
  ): Promise<void>;
  getRun(id: string): Promise<Run | null>;
}

export type RunEvent =
  /**
   * The run exists and is waiting its turn. Emitted by the server's queue, not
   * by `runScenario` -- by the time the runner has the job, the run is already
   * starting.
   *
   * It lives in this union anyway because the bus that carries it is typed by
   * this union, and because it is the counterpart of `run_started`: a history
   * view that listens only for the latter learns nothing until a device is free,
   * so a batch of five posted from one tab leaves every other tab showing four
   * runs that do not exist yet.
   */
  | { type: "run_queued"; runId: string; scenario: Scenario }
  | { type: "run_started"; runId: string; scenario: Scenario }
  | { type: "case_started"; runId: string; caseId: string; caseRun: CaseRun }
  | { type: "step_started"; runId: string; caseId: string; index: number }
  | { type: "ui_captured"; runId: string; caseId: string; index: number; uiText: string }
  | {
      type: "action_decided";
      runId: string;
      caseId: string;
      index: number;
      action: Action;
      /** Wall-clock cost of the decision, retries included. */
      llmDurationMs: number;
    }
  | { type: "action_executed"; runId: string; caseId: string; index: number; action: Action }
  | { type: "step_recorded"; runId: string; caseId: string; step: Step }
  | {
      type: "case_finished";
      runId: string;
      caseId: string;
      /** Never `queued`: a case is created at the moment its turn comes. */
      status: CaseStatus;
      reason: string | null;
      videoPath: string | null;
    }
  | { type: "run_finished"; runId: string; status: RunStatus; reason: string | null };

export interface RunDeps {
  /**
   * Opened per case, so a scenario may mix platforms. Cases still run one at a
   * time, so no two sessions are ever live at once.
   */
  openDriver: OpenDriver;
  /** Built per case, so each case can run on its own model. */
  llm: LlmFactory;
  reviewPersonas?: PersonaReviewer | undefined;
  store: StoreLike;
  screenshotDir: string;
  /** Last resort when neither the case nor the scenario names a model. */
  defaultModel: string;
  /**
   * Last resort when neither the case nor the scenario names a screen format.
   * Optional, unlike the model, because `text` is a real answer: it is what
   * every run before the switch used.
   */
  defaultUiFormat?: UiFormat | undefined;
  onEvent?: ((event: RunEvent) => void) | undefined;
  /** Defaults to a no-op; the caller decides whether a run writes NDJSON. */
  logger?: Logger | undefined;
  runId?: string | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
  /** Injection seam for the step timer; tests make a decision cost exact ms. */
  clock?: Clock | undefined;
}

export interface CaseResult {
  caseId: string;
  /** Never `queued`; a case is only created once its turn has come. */
  status: CaseStatus;
  reason: string | null;
  steps: number;
  videoPath: string | null;
}

export interface RunResult {
  runId: string;
  status: RunStatus;
  reason: string | null;
  cases: CaseResult[];
}

export class RefResolutionError extends Error {
  override readonly name = "RefResolutionError";
}

/**
 * How many past steps the prompt carries.
 *
 * Raised from 10 once cases started running deeper than a login form: at 10 an
 * agent five screens in could no longer see how it got there, and would retrace
 * a branch it had already ruled out. Remembered facts deliberately sit outside
 * this window — see `notebook` below.
 */
const HISTORY_WINDOW = 30;

/** Consecutive identical (screen, action) pairs before the prompt says so. */
const LOOP_WARN_AFTER = 2;
/** …and before the repetition is also written to the step's note. */
const LOOP_NOTE_AFTER = 3;

const LOOP_WARNING =
  "WARNING: the last action was repeated on an identical screen with no effect; " +
  "try a different action or finish with failed";

function describeAction(action: Action): string {
  switch (action.type) {
    case "tap":
      return `tap [${action.ref}]`;
    case "input_text":
      return `type ${JSON.stringify(action.text)} into [${action.ref}]`;
    case "swipe":
      return `swipe ${action.direction}`;
    case "key_event":
      return `press ${action.key}`;
    case "wait":
      return `wait ${action.ms}ms`;
    case "remember":
      return `remember ${JSON.stringify(action.text)}`;
    case "finish":
      return `finish ${action.verdict}: ${action.reason}`;
  }
}

/**
 * Tracks how many times running has produced no change.
 *
 * A repetition is the pair (screen, action): the same tap on two different
 * screens is progress, and two different actions on one screen is the agent
 * exploring. Only both together mean the step accomplished nothing.
 *
 * The screen is keyed by its serialized text rather than a hash: the strings
 * are already in hand, comparing them is exact where a hash only makes
 * collisions unlikely, and nothing here is stored beyond the previous step.
 */
class LoopDetector {
  #previousKey: string | null = null;
  #repeats = 0;

  /** Returns how many times this exact (screen, action) pair has now repeated. */
  observe(uiText: string, actionDescription: string): number {
    const key = `${uiText}\u0000${actionDescription}`;
    const isRepeat = key === this.#previousKey;
    this.#repeats = isRepeat ? this.#repeats + 1 : 1;
    this.#previousKey = key;
    return this.#repeats;
  }
}

function resolveRef(refs: Map<number, UiRef>, ref: number): UiRef {
  const target = refs.get(ref);
  if (target === undefined) {
    const available = [...refs.keys()].join(", ") || "none";
    throw new RefResolutionError(`no element [${ref}] on screen (available: ${available})`);
  }
  return target;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Gap between readiness polls; a cold activity settles well inside one. */
const LAUNCH_POLL_INTERVAL_MS = 500;
/** 10 x 500ms: five seconds is past any cold start this app has shown. */
const LAUNCH_POLL_ATTEMPTS = 10;

/**
 * Runs every case in a scenario, in order, to one verdict per case.
 *
 * Cases run sequentially rather than in parallel because they share a single
 * device: two cases driving the same screen would interleave taps. Each starts
 * from a force-stopped app so an earlier case cannot leave state behind, and a
 * failing case does not stop the ones after it — the point of grouping cases is
 * to learn about all of them from one run.
 */
export async function runScenario(scenario: Scenario, deps: RunDeps): Promise<RunResult> {
  const { store } = deps;
  const emit = deps.onEvent ?? (() => {});
  const runId = deps.runId ?? crypto.randomUUID();
  // Bound once so runId rides on every line the run emits, including the ones
  // written from the catch below.
  const log = (deps.logger ?? noopLogger).child({ runId });

  await store.beginRun({ id: runId, scenarioId: scenario.id, title: scenario.title });
  emit({ type: "run_started", runId, scenario });
  log.info("run.started", {
    scenarioId: scenario.id,
    title: scenario.title,
    cases: scenario.cases.length,
  });

  const results: CaseResult[] = [];

  for (const [order, testCase] of scenario.cases.entries()) {
    const result = await runCase({ scenario, testCase, order, runId, deps, emit, log });
    results.push(result);
  }

  // A scenario passes only when every case does: a bundle that reports "passed"
  // while one of its assertions failed would be worse than no verdict at all.
  const failures = results.filter((result) => result.status !== "passed");
  const status: RunStatus = failures.length === 0 ? "passed" : "failed";
  const reason =
    failures.length === 0
      ? `all ${results.length} cases passed`
      : `${failures.length} of ${results.length} cases did not pass: ${failures
          .map((failure) => `${failure.caseId} (${failure.status})`)
          .join(", ")}`;

  await store.finishRun(runId, { status, verdictReason: reason });
  emit({ type: "run_finished", runId, status, reason });
  log.info("run.finished", { status, reason, cases: results.length });

  return { runId, status, reason, cases: results };
}

interface CaseContext {
  scenario: Scenario;
  testCase: TestCase;
  order: number;
  runId: string;
  deps: RunDeps;
  emit: (event: RunEvent) => void;
  log: Logger;
}

/**
 * Drives one case to a verdict.
 *
 * Each iteration captures the screen, asks the model for one action, executes
 * it, then records the step. A step is persisted even when the action fails to
 * execute, because the failing action is the most interesting part of the log.
 */
async function runCase(ctx: CaseContext): Promise<CaseResult> {
  const { scenario, testCase, order, runId, deps, emit } = ctx;
  const { store, screenshotDir } = deps;
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.clock ?? (() => performance.now());
  const caseId = testCase.id;
  const log = ctx.log.child({ caseId });

  const model = resolveModel(testCase, scenario, deps.defaultModel);
  const uiFormat = resolveUiFormat(testCase, scenario, deps.defaultUiFormat ?? DEFAULT_UI_FORMAT);
  const personas = resolvePersonaReview(testCase, scenario)?.personas ?? [];
  const shouldReview = personas.length > 0;
  const title = testCase.title ?? testCase.id;

  const caseRun = await store.createCase({
    runId,
    caseId,
    order,
    title,
    prompt: testCase.prompt,
    model,
    uiFormat,
  });
  emit({ type: "case_started", runId, caseId, caseRun });
  log.info("case.started", { title, model, uiFormat, maxSteps: testCase.maxSteps });

  const llm = deps.llm(model, uiFormat);
  const caseScreenshotDir = join(screenshotDir, runId, caseId);
  const history: string[] = [];
  // Never windowed, unlike `history`: a fact is recorded precisely because it
  // has to outlive the steps around it, and trimming the notebook would defeat
  // the only reason `remember` exists.
  const notebook: string[] = [];
  const loop = new LoopDetector();

  // `CaseStatus`, not `RunStatus`: a case starts the moment this function runs,
  // so `queued` is not a state it can be in and the type says so.
  let status: CaseStatus = "running";
  let reason: string | null = null;
  let index = 0;
  let videoPath: string | null = null;

  // Opened inside the same try that guards the steps: a browser that will not
  // start is a failure of this case, not of the run, and the cases after it
  // still deserve a verdict.
  let session: DriverSession | null = null;
  try {
    session = await deps.openDriver(resolveTarget(testCase, scenario));
    const open = session;

    // The recording brackets the whole case, including the reset, so the clip
    // starts on the same screen the first step sees. A failure is reported
    // rather than thrown so a crashed case's recording survives alongside its
    // error.
    const recorded = await recordCase(open.recorder, { runId, caseId }, log, () =>
      runSteps(open.driver),
    );
    videoPath = recorded.videoPath;

    const crashed = !recorded.ok;
    if (crashed) {
      throw recorded.error;
    }
  } catch (error) {
    // Handled per case, not per run: a device hiccup during one case says
    // nothing about the next.
    status = "error";
    reason = error instanceof Error ? error.message : String(error);
    log.error("case.errored", { index, ...errorFields(error) });
  } finally {
    await closeQuietly(session, log);
  }

  await store.finishCase(runId, caseId, { status, verdictReason: reason, videoPath });
  emit({ type: "case_finished", runId, caseId, status, reason, videoPath });
  log.info("case.finished", { status, reason, steps: index, videoPath });

  return { caseId, status, reason, steps: index, videoPath };

  async function runSteps(driver: Driver): Promise<void> {
    await driver.reset();
    await waitForFirstScreen(driver, { sleep, log });
    await mkdir(caseScreenshotDir, { recursive: true });

    while (index < testCase.maxSteps) {
      emit({ type: "step_started", runId, caseId, index });
      log.debug("case.step", { index });

      const tree = await driver.dumpUi();
      // The same serializer for what the model reads and what the executor
      // resolves against: a ref only means something in the rendering it was
      // read from, and the two formats number different nodes.
      const { text: uiText, refs } = serializeUi(tree, uiFormat);
      emit({ type: "ui_captured", runId, caseId, index, uiText });

      // Read before the action, so the label names the screen the decision was
      // made on rather than whatever the action navigated to.
      const signature = await screenSignature(driver);
      const reviewScreenshotPath = shouldReview
        ? await captureScreenshot(driver, caseScreenshotDir, index, log, "-review")
        : null;

      // Timed here as well as inside the client: this number includes the
      // retries a single decision needed, which is what a step's wall-clock
      // cost actually is, while `llm.decided` reports one generation.
      const decideStartedAt = now();
      const action = await llm.decide({
        scenarioPrompt: testCase.prompt,
        historySummary: history.slice(-HISTORY_WINDOW).join("\n"),
        uiText,
        // Copied rather than handed over: the notebook keeps growing after this
        // call, and a client that held the live array would see facts the
        // decision was not actually made with.
        rememberedFacts: [...notebook],
      });
      const llmDurationMs = Math.round(now() - decideStartedAt);
      emit({ type: "action_decided", runId, caseId, index, action, llmDurationMs });
      log.info("case.action_decided", {
        index,
        action: describeAction(action),
        type: action.type,
        llmDurationMs,
      });

      let note: string | null = null;
      const isFinish = action.type === "finish";
      // `remember` is bookkeeping, not a device instruction, so it is applied
      // here rather than in executeAction — which only knows how to drive adb.
      const isRemember = action.type === "remember";
      if (isRemember) {
        notebook.push(action.text);
      }

      const touchesDevice = !isFinish && !isRemember;
      if (touchesDevice) {
        try {
          await executeAction(action, { driver, refs, sleep });
          emit({ type: "action_executed", runId, caseId, index, action });
        } catch (error) {
          // Recorded rather than thrown: a bad ref is the model's mistake, and
          // the note feeds back into history so the next step can recover.
          note = error instanceof Error ? error.message : String(error);
          log.warn("case.action_failed", {
            index,
            action: describeAction(action),
            ...errorFields(error),
          });
        }
      }

      const screenshotPath = await captureScreenshot(driver, caseScreenshotDir, index, log);
      // Reviewing before acting adds up to a minute of stale UI refs. Keep the
      // pre-action image, but inspect it only after the action and its evidence.
      const personaReview = await reviewScreen(reviewScreenshotPath);

      const description = describeAction(action);
      const repeats = loop.observe(uiText, description);
      const isStuck = repeats >= LOOP_NOTE_AFTER;
      // Written to the step only once the warning has already been in the
      // prompt for a step and gone unheeded, so the stored steps mark where a
      // run truly stalled rather than every incidental repeat. Kept out of
      // `note` — that field is the executor's report on this one action, and
      // filling it would make the history line read "(failed: WARNING …)" for
      // an action that ran fine.
      const stepNote = isStuck ? joinNotes(note, LOOP_WARNING) : note;
      if (isStuck) {
        log.warn("case.loop_detected", { index, action: description, repeats });
      }

      const step = await store.addStep({
        runId,
        caseId,
        index,
        action,
        uiText,
        screenshotPath,
        note: stepNote,
        ...(personaReview === undefined ? {} : { personaReview }),
      });
      emit({ type: "step_recorded", runId, caseId, step });

      const outcome = note === null ? "" : ` (failed: ${note})`;
      history.push(`${index + 1}. ${signature}${description}${outcome}`);

      // Injected as its own history line rather than folded into the step's:
      // the warning is about the sequence, not about that one action, and a
      // line the model has not seen before is harder to skim past.
      const isRepeating = repeats >= LOOP_WARN_AFTER;
      if (isRepeating) {
        history.push(LOOP_WARNING);
      }

      index++;

      if (isFinish) {
        status = action.verdict;
        reason = action.reason;
        break;
      }
    }

    const ranOutOfSteps = status === "running";
    if (ranOutOfSteps) {
      status = "failed";
      reason = `step budget exhausted after ${testCase.maxSteps} steps without a verdict`;
      log.warn("case.budget_exhausted", { maxSteps: testCase.maxSteps });
    }
  }

  async function reviewScreen(screenshotPath: string | null): Promise<PersonaReview | undefined> {
    if (!shouldReview) {
      return undefined;
    }
    const startedAt = now();
    try {
      const hasScreenshot = screenshotPath !== null;
      if (!hasScreenshot) {
        throw new Error("The review screenshot could not be captured.");
      }
      const reviewer = deps.reviewPersonas;
      const hasReviewer = reviewer !== undefined;
      if (!hasReviewer) {
        throw new Error("Persona review is not configured.");
      }
      const report = await reviewer({ model, screenshotPath, personas });
      log.info("case.persona_reviewed", {
        index,
        model,
        durationMs: Math.round(now() - startedAt),
        personas: personas.map((persona) => persona.id),
        findings: report.reviews.reduce((count, review) => count + review.findings.length, 0),
      });
      return { status: "completed", model, screenshotPath, personas, ...report };
    } catch (error) {
      // HTTP error bodies can exceed Firestore's document limit. A schema-only
      // limit would fail the whole case at persistence instead of isolating review errors.
      const detail = (error instanceof Error ? error.message : String(error)).trim();
      const message = detail || "Persona review failed without an error message.";
      const isOversized = message.length > 4096;
      const savedError = isOversized ? `${message.slice(0, 4096)}… (truncated)` : message;
      log.warn("case.persona_review_failed", {
        index,
        model,
        durationMs: Math.round(now() - startedAt),
        error: savedError,
      });
      return {
        status: "error",
        model,
        screenshotPath,
        personas,
        error: savedError,
      };
    }
  }
}

/**
 * Ends a driver session without letting the teardown mask what the case
 * actually did. A browser context that will not close is worth knowing about,
 * but it says nothing about the verdict the steps already produced.
 */
async function closeQuietly(session: DriverSession | null, log: Logger): Promise<void> {
  const isAbsent = session === null;
  if (isAbsent) {
    return;
  }

  try {
    await session.close();
  } catch (error) {
    log.warn("case.driver_close_failed", { ...errorFields(error) });
  }
}

/**
 * Polls until the target has drawn something the model can act on.
 *
 * `am start` returns as soon as the activity is queued, so the first `dumpUi`
 * of a cold start regularly comes back with no interactive elements at all —
 * and observed runs then spent a step on `tap {ref:0}` against an empty tree,
 * earning a `no element [0] on screen` note. A page still fetching its first
 * render behaves the same way. Waiting here costs no step, so the budget goes
 * to decisions rather than to the launcher animation.
 *
 * *Why not a fixed sleep:* a delay long enough for the slowest cold start would
 * be paid by every case, and one tuned to a fast machine would still race a
 * loaded emulator. Polling the actual tree returns the moment the screen is
 * usable and is the only form that stays correct on both.
 *
 * *Why not fail when the polls run out:* readiness is a heuristic — a
 * legitimately blank splash screen looks exactly like a slow start — and a run
 * must not die because a screen was quiet for five seconds. It gives up and
 * lets the first step see whatever is there, which is the behaviour this
 * replaces.
 */
async function waitForFirstScreen(
  driver: Driver,
  ctx: { sleep: (ms: number) => Promise<void>; log: Logger },
): Promise<void> {
  for (let attempt = 1; attempt <= LAUNCH_POLL_ATTEMPTS; attempt++) {
    // Failures are swallowed rather than thrown: a dump that races the launch
    // is exactly the condition being waited out, and the first step will
    // surface a genuinely broken device anyway.
    const refCount = await countRefs(driver);
    const isReady = refCount > 0;
    if (isReady) {
      ctx.log.debug("case.launch_ready", { attempt, refs: refCount });
      return;
    }

    // Counted in polls rather than against a wall clock, so the injected
    // `sleep` a test supplies decides how long the wait actually takes.
    const isLastAttempt = attempt === LAUNCH_POLL_ATTEMPTS;
    if (!isLastAttempt) {
      await ctx.sleep(LAUNCH_POLL_INTERVAL_MS);
    }
  }

  ctx.log.warn("case.launch_wait_timeout", { attempts: LAUNCH_POLL_ATTEMPTS });
}

/**
 * Interactive elements on screen right now, or 0 when the tree cannot be read.
 *
 * Always counted with the text serializer, whatever format the case shows the
 * model. The question is "has the app drawn something actionable yet", which is
 * exactly what the text format's numbering answers. The XML format numbers
 * every node, so it would count a bare launch window as ready and skip the
 * wait entirely; nothing here acts on these refs, so no mismatch can follow.
 */
async function countRefs(driver: Driver): Promise<number> {
  try {
    const { refs } = serializeForLlm(await driver.dumpUi());
    return refs.size;
  } catch {
    return 0;
  }
}

/**
 * Prefix that names the screen a step acted on, e.g. `[.MainActivity] `.
 *
 * Without it a history of twenty taps is indistinguishable from twenty taps on
 * one screen, which is exactly the confusion a deep navigation stack creates.
 * Returns `""` — leaving the older, unlabelled format — whenever the driver
 * cannot say, so nothing about the run depends on it.
 */
async function screenSignature(driver: Driver): Promise<string> {
  // Bound before the guard so the narrowing survives the await; a property
  // access is re-widened to optional on every use.
  const report = driver.screenLabel?.bind(driver);
  const canReport = report !== undefined;
  if (!canReport) {
    return "";
  }

  try {
    const label = await report();
    return label === "" ? "" : `[${label}] `;
  } catch {
    // A driver that *can* report but fails to must degrade the same way as one
    // that cannot -- reading a page mid-navigation throws, and this is a prefix
    // on a history line, not something a verdict may turn on. `countRefs` and
    // `captureScreenshot` swallow their failures for the same reason.
    return "";
  }
}

/** Appends a note to an existing one, or starts the note when there is none. */
function joinNotes(existing: string | null, addition: string): string {
  return existing === null ? addition : `${existing}; ${addition}`;
}

async function captureScreenshot(
  driver: Driver,
  dir: string,
  index: number,
  log: Logger,
  suffix = "",
): Promise<string | null> {
  try {
    return await driver.screencap(join(dir, `${String(index).padStart(3, "0")}${suffix}.png`));
  } catch (error) {
    // A missing screenshot must not fail the case: the step log is what decides
    // the verdict, and the image is only a debugging aid. Logged rather than
    // swallowed outright, so a device that never produces one is diagnosable.
    log.warn("case.screenshot_failed", { index, ...errorFields(error) });
    return null;
  }
}

async function executeAction(
  action: Action,
  ctx: { driver: Driver; refs: Map<number, UiRef>; sleep: (ms: number) => Promise<void> },
): Promise<void> {
  const { driver, refs, sleep } = ctx;

  switch (action.type) {
    case "tap": {
      const { center } = resolveRef(refs, action.ref);
      await driver.tap(center.x, center.y);
      return;
    }
    case "input_text": {
      const { center } = resolveRef(refs, action.ref);
      // Tap first: typed text goes to whatever holds focus, which is not
      // necessarily the field the model chose.
      await driver.tap(center.x, center.y);
      await driver.typeText(action.text);
      return;
    }
    case "swipe":
      await driver.swipe(action.direction);
      return;
    case "key_event":
      await driver.keyevent(action.key);
      return;
    case "wait":
      await sleep(action.ms);
      return;
    // Both are decided in the loop rather than executed: one only ends the
    // case, the other only writes to the notebook, and neither touches the
    // driver.
    case "remember":
    case "finish":
      return;
  }
}
