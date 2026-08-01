import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import type {
  Action,
  AppTarget,
  CaseRun,
  Run,
  RunStatus,
  Scenario,
  Step,
  TestCase,
  UiNode,
} from "@gemma-e2e/core";
import { resolveModel } from "@gemma-e2e/core";
import { serializeForLlm, type UiRef } from "@gemma-e2e/adb";
import { errorFields, type Logger, noopLogger } from "@gemma-e2e/logger";
import type { Clock, LlmFactory } from "./llm.ts";
import { recordCase, type Recorder } from "./recorder.ts";

/** The slice of AdbClient the loop needs; a fake satisfies it in tests. */
export interface AdbLike {
  dumpUi(): Promise<UiNode>;
  tap(x: number, y: number): Promise<void>;
  typeText(text: string): Promise<void>;
  swipe(direction: "up" | "down" | "left" | "right"): Promise<void>;
  keyevent(key: "back" | "home" | "enter"): Promise<void>;
  screencap(destPath: string): Promise<string>;
  launchApp(pkg: string, activity?: string): Promise<void>;
  stopApp(pkg: string): Promise<void>;
}

export interface StoreLike {
  createRun(input: { id: string; scenarioId: string; title: string }): Promise<Run>;
  createCase(input: {
    runId: string;
    caseId: string;
    order: number;
    title: string;
    prompt: string;
    model: string;
  }): Promise<CaseRun>;
  addStep(input: {
    runId: string;
    caseId: string;
    index: number;
    action: Action;
    uiText: string;
    screenshotPath?: string | null | undefined;
    note?: string | null | undefined;
  }): Promise<Step>;
  finishCase(
    runId: string,
    caseId: string,
    input: {
      status: RunStatus;
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
      status: RunStatus;
      reason: string | null;
      videoPath: string | null;
    }
  | { type: "run_finished"; runId: string; status: RunStatus; reason: string | null };

export interface RunDeps {
  adb: AdbLike;
  /** Built per case, so each case can run on its own model. */
  llm: LlmFactory;
  store: StoreLike;
  screenshotDir: string;
  /** Omitted, cases run unrecorded and every `videoPath` stays null. */
  recorder?: Recorder | undefined;
  /** Last resort when neither the case nor the scenario names a model. */
  defaultModel: string;
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
  status: RunStatus;
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

const HISTORY_WINDOW = 10;

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
    case "finish":
      return `finish ${action.verdict}: ${action.reason}`;
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

  await store.createRun({ id: runId, scenarioId: scenario.id, title: scenario.title });
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
  const { adb, store, screenshotDir } = deps;
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.clock ?? (() => performance.now());
  const caseId = testCase.id;
  const log = ctx.log.child({ caseId });

  const model = resolveModel(testCase, scenario, deps.defaultModel);
  const title = testCase.title ?? testCase.id;

  const caseRun = await store.createCase({
    runId,
    caseId,
    order,
    title,
    prompt: testCase.prompt,
    model,
  });
  emit({ type: "case_started", runId, caseId, caseRun });
  log.info("case.started", { title, model, maxSteps: testCase.maxSteps });

  const llm = deps.llm(model);
  const caseScreenshotDir = join(screenshotDir, runId, caseId);
  const history: string[] = [];

  let status: RunStatus = "running";
  let reason: string | null = null;
  let index = 0;
  let videoPath: string | null = null;

  // The recording brackets the whole case, including the app reset, so the clip
  // starts on the same screen the first step sees. A failure is reported rather
  // than thrown so the recording of a crashed case survives alongside its error.
  const recorded = await recordCase(deps.recorder, { runId, caseId }, log, runSteps);
  videoPath = recorded.videoPath;

  const crashed = !recorded.ok;
  if (crashed) {
    // Handled per case, not per run: a device hiccup during one case says
    // nothing about the next, and the remaining cases still deserve a verdict.
    const { error } = recorded;
    status = "error";
    reason = error instanceof Error ? error.message : String(error);
    log.error("case.errored", { index, ...errorFields(error) });
  }

  await store.finishCase(runId, caseId, { status, verdictReason: reason, videoPath });
  emit({ type: "case_finished", runId, caseId, status, reason, videoPath });
  log.info("case.finished", { status, reason, steps: index, videoPath });

  return { caseId, status, reason, steps: index, videoPath };

  async function runSteps(): Promise<void> {
    await resetApp(adb, scenario.app);
    await mkdir(caseScreenshotDir, { recursive: true });

    while (index < testCase.maxSteps) {
      emit({ type: "step_started", runId, caseId, index });
      log.debug("case.step", { index });

      const tree = await adb.dumpUi();
      const { text: uiText, refs } = serializeForLlm(tree);
      emit({ type: "ui_captured", runId, caseId, index, uiText });

      // Timed here as well as inside the client: this number includes the
      // retries a single decision needed, which is what a step's wall-clock
      // cost actually is, while `llm.decided` reports one generation.
      const decideStartedAt = now();
      const action = await llm.decide({
        scenarioPrompt: testCase.prompt,
        historySummary: history.slice(-HISTORY_WINDOW).join("\n"),
        uiText,
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

      if (!isFinish) {
        try {
          await executeAction(action, { adb, refs, sleep });
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

      const screenshotPath = await captureScreenshot(adb, caseScreenshotDir, index, log);

      const step = await store.addStep({
        runId,
        caseId,
        index,
        action,
        uiText,
        screenshotPath,
        note,
      });
      emit({ type: "step_recorded", runId, caseId, step });

      const outcome = note === null ? "" : ` (failed: ${note})`;
      history.push(`${index + 1}. ${describeAction(action)}${outcome}`);
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
}

/**
 * Puts the app back in its launch state. force-stop before launch rather than
 * launch alone: `am start` on a process that is already running resumes
 * whatever screen the previous case left behind, so a case would inherit the
 * last one's navigation stack and login session.
 */
async function resetApp(adb: AdbLike, app: AppTarget | undefined): Promise<void> {
  const hasApp = app !== undefined;
  if (!hasApp) {
    return;
  }

  await adb.stopApp(app.package);
  await adb.launchApp(app.package, app.activity);
}

async function captureScreenshot(
  adb: AdbLike,
  dir: string,
  index: number,
  log: Logger,
): Promise<string | null> {
  try {
    return await adb.screencap(join(dir, `${String(index).padStart(3, "0")}.png`));
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
  ctx: { adb: AdbLike; refs: Map<number, UiRef>; sleep: (ms: number) => Promise<void> },
): Promise<void> {
  const { adb, refs, sleep } = ctx;

  switch (action.type) {
    case "tap": {
      const { center } = resolveRef(refs, action.ref);
      await adb.tap(center.x, center.y);
      return;
    }
    case "input_text": {
      const { center } = resolveRef(refs, action.ref);
      // Tap first: `input text` goes to whatever holds focus, which is not
      // necessarily the field the model chose.
      await adb.tap(center.x, center.y);
      await adb.typeText(action.text);
      return;
    }
    case "swipe":
      await adb.swipe(action.direction);
      return;
    case "key_event":
      await adb.keyevent(action.key);
      return;
    case "wait":
      await sleep(action.ms);
      return;
    case "finish":
      return;
  }
}
