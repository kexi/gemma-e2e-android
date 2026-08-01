import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Action } from "@gemma-e2e/core";
import { createLogger, type LogEvent } from "@gemma-e2e/logger";
import { runScenario, type RunEvent } from "./run.ts";
import {
  FakeAdb,
  FakeRecorder,
  FakeStore,
  HOME_XML,
  LOGIN_XML,
  scenario,
  ScriptedLlmFactory,
  testCase,
} from "./fakes.ts";

let screenshotDir: string;

beforeEach(async () => {
  screenshotDir = await mkdtemp(join(tmpdir(), "gemma-shots-"));
});

afterEach(async () => {
  await rm(screenshotDir, { recursive: true, force: true });
});

const DEFAULT_MODEL = "env-model";

/** One script shared by every case unless the caller passes several. */
function harness(
  scripts: (Action | Error)[] | (Action | Error)[][],
  screens = [LOGIN_XML, HOME_XML],
) {
  const perCase = Array.isArray(scripts[0])
    ? (scripts as (Action | Error)[][])
    : [scripts as (Action | Error)[]];
  const adb = new FakeAdb(screens);
  const llm = new ScriptedLlmFactory(perCase);
  const store = new FakeStore();
  const events: RunEvent[] = [];

  return {
    adb,
    llm,
    store,
    events,
    deps: {
      adb,
      llm: llm.build,
      store,
      screenshotDir,
      defaultModel: DEFAULT_MODEL,
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

const FINISH_FAILED: Action = {
  type: "finish",
  verdict: "failed",
  reason: "no greeting",
};

describe("happy path", () => {
  test("runs a single case to a passed verdict and records every step", async () => {
    const h = harness([{ type: "tap", ref: 1 }, FINISH_PASSED]);

    const result = await runScenario(scenario(), h.deps);

    expect(result.status).toBe("passed");
    expect(result.cases).toHaveLength(1);
    expect(result.cases[0]?.status).toBe("passed");
    expect(result.cases[0]?.reason).toBe("greeting is visible");
    expect(result.cases[0]?.steps).toBe(2);

    const run = h.store.run("run-1");
    expect(run?.status).toBe("passed");
    expect(h.store.case("run-1", "logs-in")?.steps.map((s) => s.index)).toEqual([0, 1]);
  });

  test("stores the UI text the model actually saw", async () => {
    const h = harness([FINISH_PASSED]);

    await runScenario(scenario(), h.deps);

    const uiText = h.store.case("run-1", "logs-in")?.steps[0]?.uiText ?? "";
    expect(uiText).toContain("Sign in");
    expect(uiText).toContain("[0]");
  });

  test("files screenshots under the run and the case", async () => {
    const h = harness([{ type: "tap", ref: 1 }, FINISH_PASSED]);

    await runScenario(scenario(), h.deps);

    const paths = h.store.case("run-1", "logs-in")?.steps.map((s) => s.screenshotPath) ?? [];
    expect(paths[0]).toBe(join(screenshotDir, "run-1", "logs-in", "000.png"));
    expect(paths[1]).toBe(join(screenshotDir, "run-1", "logs-in", "001.png"));
  });

  test("feeds prior steps back as history", async () => {
    const h = harness([{ type: "tap", ref: 1 }, FINISH_PASSED]);

    await runScenario(scenario(), h.deps);

    expect(h.llm.clients[0]?.inputs[0]?.historySummary).toBe("");
    expect(h.llm.clients[0]?.inputs[1]?.historySummary).toContain("tap [1]");
  });

  test("prompts the model with the case's prompt, not the scenario title", async () => {
    const h = harness([FINISH_PASSED]);

    await runScenario(
      scenario({ cases: [testCase({ prompt: "check the error message" })] }),
      h.deps,
    );

    expect(h.llm.clients[0]?.inputs[0]?.scenarioPrompt).toBe("check the error message");
  });
});

describe("multiple cases", () => {
  const twoCases = scenario({
    cases: [testCase({ id: "valid" }), testCase({ id: "invalid" })],
  });

  test("runs every case sequentially and reports one result each", async () => {
    const h = harness([[FINISH_PASSED], [FINISH_PASSED]]);

    const result = await runScenario(twoCases, h.deps);

    expect(result.cases.map((c) => c.caseId)).toEqual(["valid", "invalid"]);
    expect(result.status).toBe("passed");
  });

  test("passes the run only when every case passes", async () => {
    const h = harness([[FINISH_PASSED], [FINISH_FAILED]]);

    const result = await runScenario(twoCases, h.deps);

    expect(result.status).toBe("failed");
    expect(result.reason).toContain("1 of 2");
    expect(result.reason).toContain("invalid");
  });

  test("keeps going after a case fails", async () => {
    const h = harness([[FINISH_FAILED], [FINISH_PASSED]]);

    const result = await runScenario(twoCases, h.deps);

    expect(result.cases.map((c) => c.status)).toEqual(["failed", "passed"]);
  });

  test("keeps going after a case errors outright", async () => {
    const h = harness([[new Error("device offline")], [FINISH_PASSED]]);

    const result = await runScenario(twoCases, h.deps);

    expect(result.cases[0]?.status).toBe("error");
    expect(result.cases[1]?.status).toBe("passed");
    expect(result.status).toBe("failed");
  });

  test("scopes each case's steps to its own case document", async () => {
    const h = harness([[{ type: "tap", ref: 1 }, FINISH_PASSED], [FINISH_PASSED]]);

    await runScenario(twoCases, h.deps);

    expect(h.store.case("run-1", "valid")?.steps).toHaveLength(2);
    expect(h.store.case("run-1", "invalid")?.steps).toHaveLength(1);
  });

  test("orders cases by their position in the scenario", async () => {
    const h = harness([[FINISH_PASSED], [FINISH_PASSED]]);

    await runScenario(twoCases, h.deps);

    expect(h.store.run("run-1")?.cases.map((c) => c.order)).toEqual([0, 1]);
  });
});

describe("model resolution", () => {
  test("falls back to the process default when nothing names a model", async () => {
    const h = harness([FINISH_PASSED]);

    await runScenario(scenario(), h.deps);

    expect(h.llm.models).toEqual([DEFAULT_MODEL]);
    expect(h.store.case("run-1", "logs-in")?.model).toBe(DEFAULT_MODEL);
  });

  test("uses the scenario's model for every case that has none of its own", async () => {
    const h = harness([[FINISH_PASSED], [FINISH_PASSED]]);

    await runScenario(
      scenario({
        model: "scenario-model",
        cases: [testCase({ id: "a" }), testCase({ id: "b" })],
      }),
      h.deps,
    );

    expect(h.llm.models).toEqual(["scenario-model", "scenario-model"]);
  });

  test("a case's own model wins over the scenario's", async () => {
    const h = harness([[FINISH_PASSED], [FINISH_PASSED]]);

    await runScenario(
      scenario({
        model: "scenario-model",
        cases: [testCase({ id: "a", model: "case-model" }), testCase({ id: "b" })],
      }),
      h.deps,
    );

    expect(h.llm.models).toEqual(["case-model", "scenario-model"]);
  });

  test("records the resolved model on the case", async () => {
    const h = harness([FINISH_PASSED]);

    await runScenario(scenario({ cases: [testCase({ id: "a", model: "case-model" })] }), h.deps);

    expect(h.store.case("run-1", "a")?.model).toBe("case-model");
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
    const firstStep = h.store.case("run-1", "logs-in")?.steps[0];
    expect(firstStep?.note).toContain("no element [99]");
    expect(h.adb.methodNames()).not.toContain("tap");
  });

  test("surfaces the failure to the model through history", async () => {
    const h = harness([{ type: "tap", ref: 99 }, FINISH_PASSED], [LOGIN_XML]);

    await runScenario(scenario(), h.deps);

    expect(h.llm.clients[0]?.inputs[1]?.historySummary).toContain("failed:");
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

describe("app reset between cases", () => {
  const withApp = { package: "com.example.app", activity: ".MainActivity" };

  test("force-stops before launching so a case starts clean", async () => {
    const h = harness([FINISH_PASSED]);

    await runScenario(scenario({ app: withApp }), h.deps);

    expect(h.adb.calls[0]).toEqual({ method: "stopApp", args: ["com.example.app"] });
    expect(h.adb.calls[1]).toEqual({
      method: "launchApp",
      args: ["com.example.app", ".MainActivity"],
    });
  });

  test("resets once per case, not once per run", async () => {
    const h = harness([[FINISH_PASSED], [FINISH_PASSED]]);

    await runScenario(
      scenario({ app: withApp, cases: [testCase({ id: "a" }), testCase({ id: "b" })] }),
      h.deps,
    );

    expect(h.adb.methodNames().filter((m) => m === "stopApp")).toHaveLength(2);
    expect(h.adb.methodNames().filter((m) => m === "launchApp")).toHaveLength(2);
  });

  test("skips the reset when the scenario has no app block", async () => {
    const h = harness([FINISH_PASSED]);

    await runScenario(scenario(), h.deps);

    expect(h.adb.methodNames()).not.toContain("launchApp");
    expect(h.adb.methodNames()).not.toContain("stopApp");
  });
});

describe("step budget", () => {
  test("fails the case when maxSteps is reached without a verdict", async () => {
    const h = harness([{ type: "swipe", direction: "up" }], [LOGIN_XML]);

    const result = await runScenario(scenario({ cases: [testCase({ maxSteps: 3 })] }), h.deps);

    expect(result.status).toBe("failed");
    expect(result.cases[0]?.steps).toBe(3);
    expect(result.cases[0]?.reason).toContain("step budget exhausted");
    expect(h.store.case("run-1", "logs-in")?.steps).toHaveLength(3);
  });

  test("stops immediately when maxSteps allows a single step", async () => {
    const h = harness([{ type: "swipe", direction: "up" }], [LOGIN_XML]);

    const result = await runScenario(scenario({ cases: [testCase({ maxSteps: 1 })] }), h.deps);

    expect(result.cases[0]?.steps).toBe(1);
    expect(result.cases[0]?.status).toBe("failed");
  });
});

describe("verdicts and errors", () => {
  test("a failed verdict from the model ends the case as failed", async () => {
    const h = harness([
      { type: "finish", verdict: "failed", reason: "login button never enabled" },
    ]);

    const result = await runScenario(scenario(), h.deps);

    expect(result.cases[0]?.status).toBe("failed");
    expect(result.cases[0]?.reason).toBe("login button never enabled");
  });

  test("an LLM that never returns a valid action ends the case as error", async () => {
    const h = harness([new Error("model failed to produce a valid action after 3 attempts")]);

    const result = await runScenario(scenario(), h.deps);

    expect(result.cases[0]?.status).toBe("error");
    expect(result.cases[0]?.reason).toContain("after 3 attempts");
    expect(h.store.case("run-1", "logs-in")?.status).toBe("error");
  });

  test("an adb failure during capture ends the case as error", async () => {
    const h = harness([FINISH_PASSED], [LOGIN_XML]);
    h.adb.dumpUi = async () => {
      throw new Error("device offline");
    };

    const result = await runScenario(scenario(), h.deps);

    expect(result.cases[0]?.status).toBe("error");
    expect(result.cases[0]?.reason).toBe("device offline");
  });

  test("a screenshot failure is tolerated and leaves the path null", async () => {
    const adb = new FakeAdb([LOGIN_XML], { screencap: true });
    const llm = new ScriptedLlmFactory([[FINISH_PASSED]]);
    const store = new FakeStore();

    const result = await runScenario(scenario(), {
      adb,
      llm: llm.build,
      store,
      screenshotDir,
      defaultModel: DEFAULT_MODEL,
      runId: "run-1",
      sleep: async () => {},
    });

    expect(result.status).toBe("passed");
    expect(store.case("run-1", "logs-in")?.steps[0]?.screenshotPath).toBeNull();
  });
});

describe("screen recording", () => {
  const twoCases = scenario({
    cases: [testCase({ id: "valid" }), testCase({ id: "invalid" })],
  });

  test("films every case start to finish, one recording at a time", async () => {
    const h = harness([[FINISH_PASSED], [FINISH_PASSED]]);
    const recorder = new FakeRecorder();

    await runScenario(twoCases, { ...h.deps, recorder });

    expect(recorder.calls).toEqual(["start:valid", "stop:valid", "start:invalid", "stop:invalid"]);
  });

  test("starts recording before the app reset, so the clip covers the whole case", async () => {
    const h = harness([FINISH_PASSED]);
    const recorder = new FakeRecorder();
    const order: string[] = [];
    const stopApp = h.adb.stopApp.bind(h.adb);
    h.adb.stopApp = async (pkg: string) => {
      order.push(...recorder.calls, "stopApp");
      await stopApp(pkg);
    };

    await runScenario(scenario({ app: { package: "com.example.app" } }), {
      ...h.deps,
      recorder,
    });

    expect(order).toEqual(["start:logs-in", "stopApp"]);
  });

  test("stores the recording path on the case", async () => {
    const h = harness([FINISH_PASSED]);

    const result = await runScenario(scenario(), { ...h.deps, recorder: new FakeRecorder() });

    expect(result.cases[0]?.videoPath).toBe("/videos/run-1/logs-in.mp4");
    expect(h.store.case("run-1", "logs-in")?.videoPath).toBe("/videos/run-1/logs-in.mp4");
  });

  test("leaves videoPath null when no recorder is injected", async () => {
    const h = harness([FINISH_PASSED]);

    const result = await runScenario(scenario(), h.deps);

    expect(result.cases[0]?.videoPath).toBeNull();
    expect(h.store.case("run-1", "logs-in")?.videoPath).toBeNull();
  });

  test("passes the case even when the recorder never starts", async () => {
    const h = harness([FINISH_PASSED]);

    const result = await runScenario(scenario(), {
      ...h.deps,
      recorder: new FakeRecorder({ start: true }),
    });

    expect(result.status).toBe("passed");
    expect(result.cases[0]?.videoPath).toBeNull();
  });

  test("passes the case even when the recording cannot be finalised", async () => {
    const h = harness([FINISH_PASSED]);

    const result = await runScenario(scenario(), {
      ...h.deps,
      recorder: new FakeRecorder({ stop: true }),
    });

    expect(result.status).toBe("passed");
    expect(h.store.case("run-1", "logs-in")?.videoPath).toBeNull();
  });

  test("keeps the recording of a case that errored", async () => {
    const h = harness([[new Error("device offline")], [FINISH_PASSED]]);
    const recorder = new FakeRecorder();

    const result = await runScenario(twoCases, { ...h.deps, recorder });

    expect(result.cases[0]?.status).toBe("error");
    expect(result.cases[0]?.videoPath).toBe("/videos/run-1/valid.mp4");
    expect(recorder.calls).toContain("stop:valid");
  });

  test("carries the recording path on case_finished", async () => {
    const h = harness([FINISH_PASSED]);

    await runScenario(scenario(), { ...h.deps, recorder: new FakeRecorder() });

    expect(h.events.find((e) => e.type === "case_finished")).toMatchObject({
      videoPath: "/videos/run-1/logs-in.mp4",
    });
  });
});

describe("events", () => {
  test("fires in a stable order for a two-step case", async () => {
    const h = harness([{ type: "tap", ref: 1 }, FINISH_PASSED]);

    await runScenario(scenario(), h.deps);

    expect(h.events.map((e) => e.type)).toEqual([
      "run_started",
      "case_started",
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
      "case_finished",
      "run_finished",
    ]);
  });

  test("tags every per-case event with its caseId", async () => {
    const h = harness([[FINISH_PASSED], [FINISH_PASSED]]);

    await runScenario(scenario({ cases: [testCase({ id: "a" }), testCase({ id: "b" })] }), h.deps);

    const stepEvents = h.events.filter((e) => e.type === "step_recorded");
    expect(stepEvents.map((e) => (e as { caseId: string }).caseId)).toEqual(["a", "b"]);
  });

  test("omits action_executed when the action could not run", async () => {
    const h = harness([{ type: "tap", ref: 99 }, FINISH_PASSED], [LOGIN_XML]);

    await runScenario(scenario(), h.deps);

    expect(h.events.filter((e) => e.type === "action_executed")).toHaveLength(0);
  });

  test("carries the verdict on case_finished and run_finished", async () => {
    const h = harness([FINISH_PASSED]);

    await runScenario(scenario(), h.deps);

    expect(h.events.find((e) => e.type === "case_finished")).toMatchObject({
      caseId: "logs-in",
      status: "passed",
      reason: "greeting is visible",
    });
    expect(h.events.at(-1)).toMatchObject({ type: "run_finished", status: "passed" });
  });

  test("still emits run_finished when a case errors", async () => {
    const h = harness([new Error("boom")]);

    await runScenario(scenario(), h.deps);

    expect(h.events.at(-1)).toMatchObject({ type: "run_finished", status: "failed" });
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

  test("tags every case line with its caseId", async () => {
    const log = capture();
    const h = harness([FINISH_PASSED]);

    await runScenario(scenario(), { ...h.deps, logger: log.logger });

    const caseLines = log.events().filter((e) => String(e.event).startsWith("case."));
    expect(caseLines.length).toBeGreaterThan(0);
    expect(caseLines.every((e) => e["caseId"] === "logs-in")).toBe(true);
  });

  test("records the resolved model on case.started", async () => {
    const log = capture();
    const h = harness([FINISH_PASSED]);

    await runScenario(scenario({ cases: [testCase({ model: "case-model" })] }), {
      ...h.deps,
      logger: log.logger,
    });

    expect(log.events().find((e) => e.event === "case.started")).toMatchObject({
      model: "case-model",
    });
  });

  test("records the verdict on case.finished", async () => {
    const log = capture();
    const h = harness([FINISH_PASSED]);

    await runScenario(scenario(), { ...h.deps, logger: log.logger });

    expect(log.events().find((e) => e.event === "case.finished")).toMatchObject({
      level: "info",
      status: "passed",
      reason: "greeting is visible",
    });
  });

  test("warns when an action fails without ending the case", async () => {
    const log = capture();
    const h = harness([{ type: "tap", ref: 99 }, FINISH_PASSED]);

    await runScenario(scenario(), { ...h.deps, logger: log.logger });

    const failure = log.events().find((e) => e.event === "case.action_failed");
    expect(failure).toMatchObject({ level: "warn", index: 0 });
    expect(String(failure?.["error"])).toContain("no element [99]");
  });

  test("logs an errored case at error level", async () => {
    const log = capture();
    const h = harness([new Error("boom")]);

    await runScenario(scenario(), { ...h.deps, logger: log.logger });

    expect(log.events().find((e) => e.event === "case.errored")).toMatchObject({
      level: "error",
      error: "boom",
    });
  });

  test("warns when the step budget runs out", async () => {
    const log = capture();
    const h = harness([{ type: "swipe", direction: "up" }]);

    await runScenario(scenario({ cases: [testCase({ maxSteps: 2 })] }), {
      ...h.deps,
      logger: log.logger,
    });

    expect(log.events().find((e) => e.event === "case.budget_exhausted")).toMatchObject({
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
