import type {
  Action,
  CaseRun,
  Run,
  RunStatus,
  Scenario,
  Step,
  TestCase,
  UiNode,
} from "@gemma-e2e/core";
import { parseUiDump } from "@gemma-e2e/adb";
import type { AdbLike, StoreLike } from "./run.ts";
import type { DecideInput, Llm } from "./llm.ts";
import type { Recorder, RecorderProcess, Recording } from "./recorder.ts";

export const LOGIN_XML = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" class="android.widget.LinearLayout" bounds="[0,0][1080,2400]" enabled="true">
    <node index="0" text="" resource-id="com.example.app:id/email" class="android.widget.EditText" content-desc="Email" clickable="true" enabled="true" bounds="[60,500][1020,640]" />
    <node index="1" text="Sign in" resource-id="com.example.app:id/submit" class="android.widget.Button" clickable="true" enabled="true" bounds="[60,1060][1020,1200]" />
  </node>
</hierarchy>`;

export const HOME_XML = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" class="android.widget.LinearLayout" bounds="[0,0][1080,2400]" enabled="true">
    <node index="0" text="Welcome, Kei" resource-id="com.example.app:id/greeting" class="android.widget.TextView" clickable="false" enabled="true" bounds="[60,300][1020,400]" />
    <node index="1" text="Log out" resource-id="com.example.app:id/logout" class="android.widget.Button" clickable="true" enabled="true" bounds="[60,600][1020,700]" />
  </node>
</hierarchy>`;

export interface AdbCall {
  method: string;
  args: unknown[];
}

/**
 * Replays a fixed sequence of screens and records every call. The last screen
 * repeats once the script runs out, which is what a real device does when an
 * action changes nothing.
 */
export class FakeAdb implements AdbLike {
  readonly calls: AdbCall[] = [];
  #screenIndex = 0;

  /**
   * Activity reported per screen, aligned with `screens`. Left empty by
   * default, so most tests exercise the unsigned history format a device that
   * cannot report its focus produces.
   */
  activities: string[] = [];

  constructor(
    private readonly screens: string[] = [LOGIN_XML],
    private readonly failures: { screencap?: boolean } = {},
  ) {}

  async focusedActivity(): Promise<string> {
    this.#record("focusedActivity");
    const index = Math.min(this.#screenIndex, this.activities.length - 1);
    return this.activities[index] ?? "";
  }

  #record(method: string, ...args: unknown[]): void {
    this.calls.push({ method, args });
  }

  methodNames(): string[] {
    return this.calls.map((call) => call.method);
  }

  async dumpUi(): Promise<UiNode> {
    this.#record("dumpUi");
    const index = Math.min(this.#screenIndex, this.screens.length - 1);
    const xml = this.screens[index] as string;
    return parseUiDump(xml);
  }

  /** Advances to the next scripted screen, simulating a UI transition. */
  advance(): void {
    this.#screenIndex++;
  }

  async tap(x: number, y: number): Promise<void> {
    this.#record("tap", x, y);
    this.advance();
  }

  async typeText(text: string): Promise<void> {
    this.#record("typeText", text);
  }

  async swipe(direction: string): Promise<void> {
    this.#record("swipe", direction);
  }

  async keyevent(key: string): Promise<void> {
    this.#record("keyevent", key);
  }

  async screencap(destPath: string): Promise<string> {
    this.#record("screencap", destPath);
    if (this.failures.screencap === true) {
      throw new Error("screencap failed");
    }
    return destPath;
  }

  async launchApp(pkg: string, activity?: string): Promise<void> {
    this.#record("launchApp", pkg, activity);
  }

  async stopApp(pkg: string): Promise<void> {
    this.#record("stopApp", pkg);
    // A relaunched app shows its first screen again, which is the whole point
    // of resetting between cases.
    this.#screenIndex = 0;
  }
}

/** Returns scripted actions in order; the last one repeats. */
export class ScriptedLlm implements Llm {
  readonly inputs: DecideInput[] = [];
  #index = 0;

  constructor(private readonly actions: (Action | Error)[]) {}

  async decide(input: DecideInput): Promise<Action> {
    this.inputs.push(input);
    const index = Math.min(this.#index++, this.actions.length - 1);
    const next = this.actions[index] as Action | Error;

    if (next instanceof Error) {
      throw next;
    }
    return next;
  }
}

/**
 * An {@link LlmFactory} that gives each case its own scripted client and
 * records the model every case asked for.
 */
export class ScriptedLlmFactory {
  /** Models requested, in the order cases reached them. */
  readonly models: string[] = [];
  readonly clients: ScriptedLlm[] = [];
  #index = 0;

  /** One script per case, in declaration order; the last one repeats. */
  constructor(private readonly scripts: (Action | Error)[][]) {}

  build = (model: string): ScriptedLlm => {
    this.models.push(model);
    const index = Math.min(this.#index++, this.scripts.length - 1);
    const client = new ScriptedLlm(this.scripts[index] as (Action | Error)[]);
    this.clients.push(client);
    return client;
  };
}

/** In-memory StoreLike, so loop tests do not touch Firestore. */
export class FakeStore implements StoreLike {
  readonly runs = new Map<string, Run>();

  async createRun(input: { id: string; scenarioId: string; title: string }): Promise<Run> {
    const run: Run = {
      ...input,
      status: "running",
      verdictReason: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      cases: [],
    };
    this.runs.set(input.id, run);
    return run;
  }

  async createCase(input: {
    runId: string;
    caseId: string;
    order: number;
    title: string;
    prompt: string;
    model: string;
  }): Promise<CaseRun> {
    const run = this.#requireRun(input.runId);
    const caseRun: CaseRun = {
      ...input,
      status: "running",
      verdictReason: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      videoPath: null,
      steps: [],
    };
    run.cases.push(caseRun);
    return caseRun;
  }

  async addStep(input: {
    runId: string;
    caseId: string;
    index: number;
    action: Action;
    uiText: string;
    screenshotPath?: string | null | undefined;
    note?: string | null | undefined;
  }): Promise<Step> {
    const caseRun = this.#requireCase(input.runId, input.caseId);

    const step: Step = {
      runId: input.runId,
      caseId: input.caseId,
      index: input.index,
      action: input.action,
      uiText: input.uiText,
      screenshotPath: input.screenshotPath ?? null,
      note: input.note ?? null,
      createdAt: new Date().toISOString(),
    };
    caseRun.steps.push(step);
    return step;
  }

  async finishCase(
    runId: string,
    caseId: string,
    input: {
      status: RunStatus;
      verdictReason?: string | null;
      videoPath?: string | null | undefined;
    },
  ): Promise<void> {
    const caseRun = this.#requireCase(runId, caseId);
    caseRun.status = input.status;
    caseRun.verdictReason = input.verdictReason ?? null;
    caseRun.finishedAt = new Date().toISOString();
    caseRun.videoPath = input.videoPath ?? null;
  }

  async finishRun(
    runId: string,
    input: { status: RunStatus; verdictReason?: string | null },
  ): Promise<void> {
    const run = this.#requireRun(runId);
    run.status = input.status;
    run.verdictReason = input.verdictReason ?? null;
    run.finishedAt = new Date().toISOString();
  }

  async getRun(id: string): Promise<Run | null> {
    return this.runs.get(id) ?? null;
  }

  /** Synchronous peek, so assertions need no await. */
  run(id: string): Run | null {
    return this.runs.get(id) ?? null;
  }

  case(runId: string, caseId: string): CaseRun | null {
    return this.runs.get(runId)?.cases.find((c) => c.caseId === caseId) ?? null;
  }

  #requireRun(runId: string): Run {
    const run = this.runs.get(runId);
    if (run === undefined) {
      throw new Error(`no such run: ${runId}`);
    }
    return run;
  }

  #requireCase(runId: string, caseId: string): CaseRun {
    const caseRun = this.#requireRun(runId).cases.find((c) => c.caseId === caseId);
    if (caseRun === undefined) {
      throw new Error(`no such case: ${runId}/${caseId}`);
    }
    return caseRun;
  }
}

/**
 * Records start/stop calls in the order they happen, so a test can assert that
 * a case is filmed from before its first adb call until after its last.
 */
export class FakeRecorder implements Recorder {
  /** `start:<caseId>` / `stop:<caseId>`, interleaved as they were called. */
  readonly calls: string[] = [];

  constructor(private readonly failures: { start?: boolean; stop?: boolean } = {}) {}

  async start(input: { runId: string; caseId: string }): Promise<Recording> {
    this.calls.push(`start:${input.caseId}`);
    if (this.failures.start === true) {
      throw new Error("scrcpy is not installed");
    }

    const path = `/videos/${input.runId}/${input.caseId}.mp4`;
    const calls = this.calls;
    const failStop = this.failures.stop === true;

    return {
      path,
      stop: async () => {
        calls.push(`stop:${input.caseId}`);
        if (failStop) {
          throw new Error("scrcpy did not exit");
        }
      },
    };
  }
}

/**
 * A scrcpy stand-in. Like the real thing under `--no-playback`, it ignores
 * SIGINT and SIGTERM entirely and exits only when the stream it was recording
 * ends — or when killed outright.
 */
export class FakeProcess implements RecorderProcess {
  readonly signals: NodeJS.Signals[] = [];
  readonly exited: Promise<number>;
  #resolve!: (code: number) => void;

  constructor(private readonly exitCode = 0) {
    this.exited = new Promise<number>((resolve) => {
      this.#resolve = resolve;
    });
  }

  kill(signal: NodeJS.Signals): void {
    this.signals.push(signal);
    // Only SIGKILL lands; the graceful signals are what scrcpy drops on the
    // floor, and a test that let them work would prove nothing.
    const isForced = signal === "SIGKILL";
    if (isForced) {
      this.#resolve(137);
    }
  }

  /** The device-side capture ended, so scrcpy finalises the file and exits. */
  streamClosed(): void {
    this.#resolve(this.exitCode);
  }

  /** Ends the process on its own, as a crash would. */
  die(code = 1): void {
    this.#resolve(code);
  }
}

export function testCase(overrides: Partial<TestCase> = {}): TestCase {
  return {
    id: "logs-in",
    prompt: "check that the user can log in",
    maxSteps: 20,
    ...overrides,
  };
}

export function scenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    id: "login",
    title: "Login",
    cases: [testCase()],
    ...overrides,
  };
}
