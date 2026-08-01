import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Action } from "@gemma-e2e/core";
import { createLogger, type LogEvent } from "@gemma-e2e/logger";
import { runScenario, type RunEvent } from "./run.ts";
import { FakeAdb, FakeStore, HOME_XML, LOGIN_XML, scenario, ScriptedLlm } from "./fakes.ts";

let screenshotDir: string;

beforeEach(async () => {
  screenshotDir = await mkdtemp(join(tmpdir(), "gemma-shots-"));
});

afterEach(async () => {
  await rm(screenshotDir, { recursive: true, force: true });
});

function harness(actions: (Action | Error)[], screens: string[] = [LOGIN_XML, HOME_XML]) {
  const adb = new FakeAdb(screens);
  const llm = new ScriptedLlm(actions);
  const store = new FakeStore();
  const events: RunEvent[] = [];

  return {
    adb,
    llm,
    store,
    events,
    deps: {
      adb,
      llm,
      store,
      screenshotDir,
      runId: "run-1",
      onEvent: (event: RunEvent) => events.push(event),
      sleep: async () => {},
    },
  };
}

const FINISH_PASSED: Action = {
  type: "finish",
  verdict: "passed",
  reason: "greeting is visible",
};

describe("happy path", () => {
  test("runs to a passed verdict and records every step", async () => {
    const h = harness([{ type: "tap", ref: 1 }, FINISH_PASSED]);

    const result = await runScenario(scenario(), h.deps);

    expect(result.status).toBe("passed");
    expect(result.reason).toBe("greeting is visible");
    expect(result.steps).toBe(2);

    const run = h.store.getRun("run-1");
    expect(run?.status).toBe("passed");
    expect(run?.steps.map((s) => s.index)).toEqual([0, 1]);
    expect(run?.steps[0]?.action).toEqual({ type: "tap", ref: 1 });
  });

  test("stores the UI text the model actually saw", async () => {
    const h = harness([FINISH_PASSED]);

    await runScenario(scenario(), h.deps);

    const uiText = h.store.getRun("run-1")?.steps[0]?.uiText ?? "";
    expect(uiText).toContain("Sign in");
    expect(uiText).toContain("[0]");
  });

  test("captures a screenshot per step", async () => {
    const h = harness([{ type: "tap", ref: 1 }, FINISH_PASSED]);

    await runScenario(scenario(), h.deps);

    const paths = h.store.getRun("run-1")?.steps.map((s) => s.screenshotPath) ?? [];
    expect(paths[0]).toBe(join(screenshotDir, "run-1", "000.png"));
    expect(paths[1]).toBe(join(screenshotDir, "run-1", "001.png"));
  });

  test("feeds prior steps back as history", async () => {
    const h = harness([{ type: "tap", ref: 1 }, FINISH_PASSED]);

    await runScenario(scenario(), h.deps);

    expect(h.llm.inputs[0]?.historySummary).toBe("");
    expect(h.llm.inputs[1]?.historySummary).toContain("tap [1]");
  });
});

describe("ref resolution", () => {
  test("translates a tap ref into the element's centre coordinates", async () => {
    const h = harness([{ type: "tap", ref: 1 }, FINISH_PASSED]);

    await runScenario(scenario(), h.deps);

    // The Sign in button spans [60,1060][1020,1200].
    const tap = h.adb.calls.find((c) => c.method === "tap");
    expect(tap?.args).toEqual([540, 1130]);
  });

  test("input_text taps the field before typing", async () => {
    const h = harness(
      [{ type: "input_text", ref: 0, text: "kei@example.com" }, FINISH_PASSED],
      [LOGIN_XML],
    );

    await runScenario(scenario(), h.deps);

    const methods = h.adb.methodNames();
    const tapIndex = methods.indexOf("tap");
    const typeIndex = methods.indexOf("typeText");
    expect(tapIndex).toBeGreaterThanOrEqual(0);
    expect(typeIndex).toBeGreaterThan(tapIndex);
    // The email field spans [60,500][1020,640].
    expect(h.adb.calls[tapIndex]?.args).toEqual([540, 570]);
    expect(h.adb.calls[typeIndex]?.args).toEqual(["kei@example.com"]);
  });

  test("records a note and keeps going when the model invents a ref", async () => {
    const h = harness([{ type: "tap", ref: 99 }, FINISH_PASSED], [LOGIN_XML]);

    const result = await runScenario(scenario(), h.deps);

    expect(result.status).toBe("passed");
    const firstStep = h.store.getRun("run-1")?.steps[0];
    expect(firstStep?.note).toContain("no element [99]");
    expect(h.adb.methodNames()).not.toContain("tap");
  });

  test("surfaces the failure to the model through history", async () => {
    const h = harness([{ type: "tap", ref: 99 }, FINISH_PASSED], [LOGIN_XML]);

    await runScenario(scenario(), h.deps);

    expect(h.llm.inputs[1]?.historySummary).toContain("failed:");
  });
});

describe("action dispatch", () => {
  test("swipe and key_event reach adb", async () => {
    const h = harness(
      [{ type: "swipe", direction: "down" }, { type: "key_event", key: "back" }, FINISH_PASSED],
      [LOGIN_XML],
    );

    await runScenario(scenario(), h.deps);

    const swipe = h.adb.calls.find((c) => c.method === "swipe");
    const key = h.adb.calls.find((c) => c.method === "keyevent");
    expect(swipe?.args).toEqual(["down"]);
    expect(key?.args).toEqual(["back"]);
  });

  test("wait sleeps for the requested duration without touching adb", async () => {
    const slept: number[] = [];
    const h = harness([{ type: "wait", ms: 750 }, FINISH_PASSED], [LOGIN_XML]);

    await runScenario(scenario(), {
      ...h.deps,
      sleep: async (ms: number) => {
        slept.push(ms);
      },
    });

    expect(slept).toEqual([750]);
  });
});

describe("app launch", () => {
  test("launches the app when the scenario names one", async () => {
    const h = harness([FINISH_PASSED]);

    await runScenario(
      scenario({ app: { package: "com.example.app", activity: ".MainActivity" } }),
      h.deps,
    );

    expect(h.adb.calls[0]).toEqual({
      method: "launchApp",
      args: ["com.example.app", ".MainActivity"],
    });
  });

  test("skips launching when the scenario has no app block", async () => {
    const h = harness([FINISH_PASSED]);

    await runScenario(scenario(), h.deps);

    expect(h.adb.methodNames()).not.toContain("launchApp");
  });
});

describe("step budget", () => {
  test("fails the run when maxSteps is reached without a verdict", async () => {
    const h = harness([{ type: "swipe", direction: "up" }], [LOGIN_XML]);

    const result = await runScenario(scenario({ maxSteps: 3 }), h.deps);

    expect(result.status).toBe("failed");
    expect(result.steps).toBe(3);
    expect(result.reason).toContain("step budget exhausted");
    expect(h.store.getRun("run-1")?.steps).toHaveLength(3);
  });

  test("stops immediately when maxSteps allows a single step", async () => {
    const h = harness([{ type: "swipe", direction: "up" }], [LOGIN_XML]);

    const result = await runScenario(scenario({ maxSteps: 1 }), h.deps);

    expect(result.steps).toBe(1);
    expect(result.status).toBe("failed");
  });
});

describe("verdicts and errors", () => {
  test("a failed verdict from the model ends the run as failed", async () => {
    const h = harness([
      { type: "finish", verdict: "failed", reason: "login button never enabled" },
    ]);

    const result = await runScenario(scenario(), h.deps);

    expect(result.status).toBe("failed");
    expect(result.reason).toBe("login button never enabled");
  });

  test("an LLM that never returns a valid action ends the run as error", async () => {
    const h = harness([new Error("model failed to produce a valid action after 3 attempts")]);

    const result = await runScenario(scenario(), h.deps);

    expect(result.status).toBe("error");
    expect(result.reason).toContain("after 3 attempts");
    expect(h.store.getRun("run-1")?.status).toBe("error");
  });

  test("an adb failure during capture ends the run as error", async () => {
    const adb = new FakeAdb([LOGIN_XML]);
    adb.dumpUi = async () => {
      throw new Error("device offline");
    };
    const store = new FakeStore();

    const result = await runScenario(scenario(), {
      adb,
      llm: new ScriptedLlm([FINISH_PASSED]),
      store,
      screenshotDir,
      runId: "run-1",
      sleep: async () => {},
    });

    expect(result.status).toBe("error");
    expect(result.reason).toBe("device offline");
  });

  test("a screenshot failure is tolerated and leaves the path null", async () => {
    const adb = new FakeAdb([LOGIN_XML], { screencap: true });
    const store = new FakeStore();

    const result = await runScenario(scenario(), {
      adb,
      llm: new ScriptedLlm([FINISH_PASSED]),
      store,
      screenshotDir,
      runId: "run-1",
      sleep: async () => {},
    });

    expect(result.status).toBe("passed");
    expect(store.getRun("run-1")?.steps[0]?.screenshotPath).toBeNull();
  });
});

describe("events", () => {
  test("fires in a stable order for a two-step run", async () => {
    const h = harness([{ type: "tap", ref: 1 }, FINISH_PASSED]);

    await runScenario(scenario(), h.deps);

    expect(h.events.map((e) => e.type)).toEqual([
      "run_started",
      "step_started",
      "ui_captured",
      "action_decided",
      "action_executed",
      "step_recorded",
      "step_started",
      "ui_captured",
      "action_decided",
      // A finish action executes nothing, so no action_executed here.
      "step_recorded",
      "run_finished",
    ]);
  });

  test("omits action_executed when the action could not run", async () => {
    const h = harness([{ type: "tap", ref: 99 }, FINISH_PASSED], [LOGIN_XML]);

    await runScenario(scenario(), h.deps);

    expect(h.events.filter((e) => e.type === "action_executed")).toHaveLength(0);
  });

  test("carries the verdict on run_finished", async () => {
    const h = harness([FINISH_PASSED]);

    await runScenario(scenario(), h.deps);

    const finished = h.events.at(-1);
    expect(finished).toMatchObject({
      type: "run_finished",
      status: "passed",
      reason: "greeting is visible",
    });
  });

  test("still emits run_finished when the run errors", async () => {
    const h = harness([new Error("boom")]);

    await runScenario(scenario(), h.deps);

    expect(h.events.at(-1)).toMatchObject({ type: "run_finished", status: "error" });
  });
});

describe("structured logging", () => {
  /** Captures NDJSON lines the way a stderr consumer would read them back. */
  function capture() {
    const lines: string[] = [];
    return {
      logger: createLogger({ sink: (line) => lines.push(line), level: "debug" }),
      events: () => lines.map((line) => JSON.parse(line) as LogEvent),
    };
  }

  test("reports a run from start to verdict, every line tagged with the runId", async () => {
    const log = capture();
    const h = harness([FINISH_PASSED]);

    await runScenario(scenario(), { ...h.deps, logger: log.logger });

    const events = log.events();
    expect(events.map((e) => e.event)).toContain("run.started");
    expect(events.map((e) => e.event)).toContain("run.finished");
    expect(events.every((e) => e["runId"] === "run-1")).toBe(true);
  });

  test("records the verdict on run.finished", async () => {
    const log = capture();
    const h = harness([FINISH_PASSED]);

    await runScenario(scenario(), { ...h.deps, logger: log.logger });

    expect(log.events().find((e) => e.event === "run.finished")).toMatchObject({
      level: "info",
      status: "passed",
      reason: "greeting is visible",
    });
  });

  test("warns when an action fails without ending the run", async () => {
    const log = capture();
    const h = harness([{ type: "tap", ref: 99 }, FINISH_PASSED]);

    await runScenario(scenario(), { ...h.deps, logger: log.logger });

    const failure = log.events().find((e) => e.event === "run.action_failed");
    expect(failure).toMatchObject({ level: "warn", index: 0 });
    expect(String(failure?.["error"])).toContain("no element [99]");
  });

  test("logs an errored run at error level", async () => {
    const log = capture();
    const h = harness([new Error("boom")]);

    await runScenario(scenario(), { ...h.deps, logger: log.logger });

    expect(log.events().find((e) => e.event === "run.errored")).toMatchObject({
      level: "error",
      error: "boom",
    });
  });

  test("warns when the step budget runs out", async () => {
    const log = capture();
    const h = harness([{ type: "swipe", direction: "up" }]);

    await runScenario(scenario({ maxSteps: 2 }), { ...h.deps, logger: log.logger });

    expect(log.events().find((e) => e.event === "run.budget_exhausted")).toMatchObject({
      level: "warn",
      maxSteps: 2,
    });
  });

  test("stays silent when no logger is injected", async () => {
    const h = harness([FINISH_PASSED]);

    const result = await runScenario(scenario(), h.deps);

    expect(result.status).toBe("passed");
  });
});
