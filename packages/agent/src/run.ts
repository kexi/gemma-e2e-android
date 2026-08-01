import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import type { Action, Run, RunStatus, Scenario, Step, UiNode } from "@gemma-e2e/core";
import { serializeForLlm, type UiRef } from "@gemma-e2e/adb";
import type { Llm } from "./llm.ts";

/** The slice of AdbClient the loop needs; a fake satisfies it in tests. */
export interface AdbLike {
  dumpUi(): Promise<UiNode>;
  tap(x: number, y: number): Promise<void>;
  typeText(text: string): Promise<void>;
  swipe(direction: "up" | "down" | "left" | "right"): Promise<void>;
  keyevent(key: "back" | "home" | "enter"): Promise<void>;
  screencap(destPath: string): Promise<string>;
  launchApp(pkg: string, activity?: string): Promise<void>;
}

export interface StoreLike {
  createRun(input: { id: string; scenarioId: string; title: string; prompt: string }): Run;
  addStep(input: {
    runId: string;
    index: number;
    action: Action;
    uiText: string;
    screenshotPath?: string | null | undefined;
    note?: string | null | undefined;
  }): Step;
  finishRun(runId: string, input: { status: RunStatus; verdictReason?: string | null }): void;
  getRun(id: string): Run | null;
}

export type RunEvent =
  | { type: "run_started"; runId: string; scenario: Scenario }
  | { type: "step_started"; runId: string; index: number }
  | { type: "ui_captured"; runId: string; index: number; uiText: string }
  | { type: "action_decided"; runId: string; index: number; action: Action }
  | { type: "action_executed"; runId: string; index: number; action: Action }
  | { type: "step_recorded"; runId: string; step: Step }
  | { type: "run_finished"; runId: string; status: RunStatus; reason: string | null };

export interface RunDeps {
  adb: AdbLike;
  llm: Llm;
  store: StoreLike;
  screenshotDir: string;
  onEvent?: ((event: RunEvent) => void) | undefined;
  runId?: string | undefined;
  now?: (() => Date) | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
}

export interface RunResult {
  runId: string;
  status: RunStatus;
  reason: string | null;
  steps: number;
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
 * Drives one scenario to a verdict.
 *
 * Each iteration captures the screen, asks the model for one action, executes
 * it, then records the step. A step is persisted even when the action fails to
 * execute, because the failing action is the most interesting part of the log.
 */
export async function runScenario(scenario: Scenario, deps: RunDeps): Promise<RunResult> {
  const { adb, llm, store, screenshotDir } = deps;
  const emit = deps.onEvent ?? (() => {});
  const sleep = deps.sleep ?? defaultSleep;
  const runId = deps.runId ?? crypto.randomUUID();

  store.createRun({
    id: runId,
    scenarioId: scenario.id,
    title: scenario.title,
    prompt: scenario.prompt,
  });
  emit({ type: "run_started", runId, scenario });

  const runScreenshotDir = join(screenshotDir, runId);
  const history: string[] = [];

  let status: RunStatus = "running";
  let reason: string | null = null;
  let index = 0;

  try {
    const hasApp = scenario.app !== undefined;
    if (hasApp) {
      const app = scenario.app as NonNullable<Scenario["app"]>;
      await adb.launchApp(app.package, app.activity);
    }

    await mkdir(runScreenshotDir, { recursive: true });

    while (index < scenario.maxSteps) {
      emit({ type: "step_started", runId, index });

      const tree = await adb.dumpUi();
      const { text: uiText, refs } = serializeForLlm(tree);
      emit({ type: "ui_captured", runId, index, uiText });

      const action = await llm.decide({
        scenarioPrompt: scenario.prompt,
        historySummary: history.slice(-HISTORY_WINDOW).join("\n"),
        uiText,
      });
      emit({ type: "action_decided", runId, index, action });

      let note: string | null = null;
      const isFinish = action.type === "finish";

      if (!isFinish) {
        try {
          await executeAction(action, { adb, refs, sleep });
          emit({ type: "action_executed", runId, index, action });
        } catch (error) {
          // Recorded rather than thrown: a bad ref is the model's mistake, and
          // the note feeds back into history so the next step can recover.
          note = error instanceof Error ? error.message : String(error);
        }
      }

      const screenshotPath = await captureScreenshot(adb, runScreenshotDir, index);

      const step = store.addStep({
        runId,
        index,
        action,
        uiText,
        screenshotPath,
        note,
      });
      emit({ type: "step_recorded", runId, step });

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
      reason = `step budget exhausted after ${scenario.maxSteps} steps without a verdict`;
    }
  } catch (error) {
    status = "error";
    reason = error instanceof Error ? error.message : String(error);
  }

  store.finishRun(runId, { status, verdictReason: reason });
  emit({ type: "run_finished", runId, status, reason });

  return { runId, status, reason, steps: index };
}

async function captureScreenshot(adb: AdbLike, dir: string, index: number): Promise<string | null> {
  try {
    return await adb.screencap(join(dir, `${String(index).padStart(3, "0")}.png`));
  } catch {
    // A missing screenshot must not fail the run: the step log is what decides
    // the verdict, and the image is only a debugging aid.
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
