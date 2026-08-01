import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Action } from "@gemma-e2e/core";
import { Store, StoreError } from "./store.ts";

let dir: string;
let store: Store;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "gemma-store-"));
  store = Store.open(join(dir, "nested", "runs.sqlite"));
});

afterEach(async () => {
  store.close();
  await rm(dir, { recursive: true, force: true });
});

function seedRun(id = "run-1") {
  return store.createRun({
    id,
    scenarioId: "login",
    title: "Login",
    prompt: "check that the user can log in",
  });
}

const TAP: Action = { type: "tap", ref: 2 };
const FINISH: Action = { type: "finish", verdict: "passed", reason: "logged in" };

describe("open", () => {
  test("creates missing parent directories", () => {
    expect(existsSync(join(dir, "nested", "runs.sqlite"))).toBe(true);
  });

  test("is idempotent: reopening an existing database preserves rows", () => {
    seedRun();
    store.close();

    store = Store.open(join(dir, "nested", "runs.sqlite"));
    expect(store.getRun("run-1")?.scenarioId).toBe("login");
  });
});

describe("createRun", () => {
  test("starts a run in the running state with no steps", () => {
    const run = seedRun();

    expect(run.status).toBe("running");
    expect(run.finishedAt).toBeNull();
    expect(run.verdictReason).toBeNull();
    expect(run.steps).toEqual([]);
    expect(run.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("rejects a duplicate run id", () => {
    seedRun();
    expect(() => seedRun()).toThrow();
  });
});

describe("addStep", () => {
  test("round-trips an action through JSON storage", () => {
    seedRun();
    store.addStep({ runId: "run-1", index: 0, action: TAP, uiText: "[2] Button" });

    expect(store.getRun("run-1")?.steps[0]?.action).toEqual(TAP);
  });

  test("preserves every action variant", () => {
    seedRun();
    const actions: Action[] = [
      { type: "tap", ref: 0 },
      { type: "input_text", ref: 1, text: "a b c" },
      { type: "swipe", direction: "down" },
      { type: "key_event", key: "back" },
      { type: "wait", ms: 250 },
      FINISH,
    ];

    actions.forEach((action, index) => {
      store.addStep({ runId: "run-1", index, action, uiText: "" });
    });

    expect(store.getRun("run-1")?.steps.map((s) => s.action)).toEqual(actions);
  });

  test("defaults the optional screenshot and note to null", () => {
    seedRun();
    const step = store.addStep({ runId: "run-1", index: 0, action: TAP, uiText: "ui" });

    expect(step.screenshotPath).toBeNull();
    expect(step.note).toBeNull();
  });

  test("stores a screenshot path and note when given", () => {
    seedRun();
    store.addStep({
      runId: "run-1",
      index: 0,
      action: TAP,
      uiText: "ui",
      screenshotPath: "var/screenshots/run-1/0.png",
      note: "tapped sign in",
    });

    const step = store.getRun("run-1")?.steps[0];
    expect(step?.screenshotPath).toBe("var/screenshots/run-1/0.png");
    expect(step?.note).toBe("tapped sign in");
  });

  test("assigns increasing ids", () => {
    seedRun();
    const first = store.addStep({ runId: "run-1", index: 0, action: TAP, uiText: "" });
    const second = store.addStep({ runId: "run-1", index: 1, action: TAP, uiText: "" });

    expect(second.id).toBeGreaterThan(first.id);
  });

  test("rejects a step for an unknown run", () => {
    expect(() => store.addStep({ runId: "ghost", index: 0, action: TAP, uiText: "" })).toThrow();
  });

  test("rejects a duplicate step index within a run", () => {
    seedRun();
    store.addStep({ runId: "run-1", index: 0, action: TAP, uiText: "" });

    expect(() => store.addStep({ runId: "run-1", index: 0, action: TAP, uiText: "" })).toThrow();
  });
});

describe("finishRun", () => {
  test("records the verdict and finish time", () => {
    seedRun();
    store.finishRun("run-1", { status: "passed", verdictReason: "logged in" });

    const run = store.getRun("run-1");
    expect(run?.status).toBe("passed");
    expect(run?.verdictReason).toBe("logged in");
    expect(run?.finishedAt).not.toBeNull();
  });

  test("supports the error status with no reason", () => {
    seedRun();
    store.finishRun("run-1", { status: "error" });

    const run = store.getRun("run-1");
    expect(run?.status).toBe("error");
    expect(run?.verdictReason).toBeNull();
  });

  test("throws for an unknown run", () => {
    expect(() => store.finishRun("ghost", { status: "passed" })).toThrow(StoreError);
  });
});

describe("getRun", () => {
  test("returns null for an unknown id", () => {
    expect(store.getRun("ghost")).toBeNull();
  });

  test("returns steps ordered by index regardless of insertion order", () => {
    seedRun();
    store.addStep({ runId: "run-1", index: 2, action: TAP, uiText: "" });
    store.addStep({ runId: "run-1", index: 0, action: TAP, uiText: "" });
    store.addStep({ runId: "run-1", index: 1, action: TAP, uiText: "" });

    expect(store.getRun("run-1")?.steps.map((s) => s.index)).toEqual([0, 1, 2]);
  });

  test("scopes steps to their own run", () => {
    seedRun("run-1");
    seedRun("run-2");
    store.addStep({ runId: "run-1", index: 0, action: TAP, uiText: "" });
    store.addStep({ runId: "run-2", index: 0, action: FINISH, uiText: "" });

    expect(store.getRun("run-1")?.steps).toHaveLength(1);
    expect(store.getRun("run-2")?.steps[0]?.action).toEqual(FINISH);
  });
});

describe("listRuns", () => {
  test("returns runs newest first without their steps", () => {
    seedRun("run-1");
    seedRun("run-2");
    store.addStep({ runId: "run-2", index: 0, action: TAP, uiText: "" });

    const runs = store.listRuns();

    expect(runs.map((r) => r.id)).toEqual(["run-2", "run-1"]);
    expect(runs[0]?.steps).toEqual([]);
  });

  test("honours the limit", () => {
    seedRun("run-1");
    seedRun("run-2");
    seedRun("run-3");

    expect(store.listRuns(2)).toHaveLength(2);
  });

  test("returns an empty list for a fresh database", () => {
    expect(store.listRuns()).toEqual([]);
  });
});
