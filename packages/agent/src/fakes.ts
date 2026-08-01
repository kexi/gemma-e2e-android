import type { Action, Run, RunStatus, Scenario, Step, UiNode } from "@gemma-e2e/core";
import { parseUiDump } from "@gemma-e2e/adb";
import type { AdbLike, StoreLike } from "./run.ts";
import type { DecideInput, Llm } from "./llm.ts";

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

  constructor(
    private readonly screens: string[] = [LOGIN_XML],
    private readonly failures: { screencap?: boolean } = {},
  ) {}

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

/** In-memory StoreLike, so loop tests do not touch the filesystem. */
export class FakeStore implements StoreLike {
  readonly runs = new Map<string, Run>();
  #nextStepId = 1;

  createRun(input: { id: string; scenarioId: string; title: string; prompt: string }): Run {
    const run: Run = {
      ...input,
      status: "running",
      verdictReason: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      steps: [],
    };
    this.runs.set(input.id, run);
    return run;
  }

  addStep(input: {
    runId: string;
    index: number;
    action: Action;
    uiText: string;
    screenshotPath?: string | null | undefined;
    note?: string | null | undefined;
  }): Step {
    const run = this.runs.get(input.runId);
    if (run === undefined) {
      throw new Error(`no such run: ${input.runId}`);
    }

    const step: Step = {
      id: this.#nextStepId++,
      runId: input.runId,
      index: input.index,
      action: input.action,
      uiText: input.uiText,
      screenshotPath: input.screenshotPath ?? null,
      note: input.note ?? null,
      createdAt: new Date().toISOString(),
    };
    run.steps.push(step);
    return step;
  }

  finishRun(runId: string, input: { status: RunStatus; verdictReason?: string | null }): void {
    const run = this.runs.get(runId);
    if (run === undefined) {
      throw new Error(`no such run: ${runId}`);
    }
    run.status = input.status;
    run.verdictReason = input.verdictReason ?? null;
    run.finishedAt = new Date().toISOString();
  }

  getRun(id: string): Run | null {
    return this.runs.get(id) ?? null;
  }
}

export function scenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    id: "login",
    title: "Login",
    prompt: "check that the user can log in",
    maxSteps: 20,
    ...overrides,
  };
}
