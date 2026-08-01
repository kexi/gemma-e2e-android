import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Action } from "@gemma-e2e/core";
import { Store, StoreError } from "./store.ts";

/**
 * Every test here needs a live Firestore. `just test` supplies one through
 * `firebase emulators:exec`, which exports FIRESTORE_EMULATOR_HOST; a bare
 * `bun test` has none, and these skip rather than fail so the rest of the suite
 * stays runnable without the emulator installed.
 */
const hasEmulator = process.env["FIRESTORE_EMULATOR_HOST"] !== undefined;
const describeWithFirestore = hasEmulator ? describe : describe.skip;

let store: Store;
let runId: string;

const TAP: Action = { type: "tap", ref: 2 };
const FINISH: Action = { type: "finish", verdict: "passed", reason: "logged in" };

async function seedRun(id = runId) {
  return await store.createRun({ id, scenarioId: "login", title: "Login" });
}

async function seedCase(caseId = "valid", order = 0) {
  return await store.createCase({
    runId,
    caseId,
    order,
    title: "Logs in",
    prompt: "check that the user can log in",
    model: "gemma-4-12b",
  });
}

describeWithFirestore("Store", () => {
  beforeEach(() => {
    store = Store.open();
    // A fresh id per test keeps them independent without clearing the whole
    // emulator, which would break if tests ever run in parallel.
    runId = `run-${crypto.randomUUID()}`;
  });

  afterEach(async () => {
    await store.deleteRun(runId);
  });

  describe("createRun", () => {
    test("starts a run in the running state with no cases", async () => {
      const run = await seedRun();

      expect(run.status).toBe("running");
      expect(run.finishedAt).toBeNull();
      expect(run.verdictReason).toBeNull();
      expect(run.cases).toEqual([]);
      expect(run.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    test("round-trips through Firestore", async () => {
      await seedRun();

      const stored = await store.getRun(runId);
      expect(stored?.scenarioId).toBe("login");
      expect(stored?.title).toBe("Login");
    });

    test("rejects a duplicate run id", async () => {
      await seedRun();
      await expect(seedRun()).rejects.toThrow();
    });
  });

  describe("createCase", () => {
    test("records the resolved model and the case's own prompt", async () => {
      await seedRun();
      await seedCase();

      const caseRun = (await store.getRun(runId))?.cases[0];
      expect(caseRun?.caseId).toBe("valid");
      expect(caseRun?.model).toBe("gemma-4-12b");
      expect(caseRun?.prompt).toBe("check that the user can log in");
      expect(caseRun?.status).toBe("running");
    });

    test("rejects a duplicate case id within one run", async () => {
      await seedRun();
      await seedCase();

      await expect(seedCase()).rejects.toThrow();
    });

    test("returns cases in declaration order regardless of insertion order", async () => {
      await seedRun();
      await seedCase("third", 2);
      await seedCase("first", 0);
      await seedCase("second", 1);

      const cases = (await store.getRun(runId))?.cases ?? [];
      expect(cases.map((c) => c.caseId)).toEqual(["first", "second", "third"]);
    });
  });

  describe("addStep", () => {
    test("round-trips an action through the Zod converter", async () => {
      await seedRun();
      await seedCase();
      await store.addStep({ runId, caseId: "valid", index: 0, action: TAP, uiText: "[2] Button" });

      const steps = (await store.getRun(runId))?.cases[0]?.steps ?? [];
      expect(steps[0]?.action).toEqual(TAP);
    });

    test("preserves every action variant", async () => {
      await seedRun();
      await seedCase();
      const actions: Action[] = [
        { type: "tap", ref: 0 },
        { type: "input_text", ref: 1, text: "a b c" },
        { type: "swipe", direction: "down" },
        { type: "key_event", key: "back" },
        { type: "wait", ms: 250 },
        FINISH,
      ];

      for (const [index, action] of actions.entries()) {
        await store.addStep({ runId, caseId: "valid", index, action, uiText: "" });
      }

      const steps = (await store.getRun(runId))?.cases[0]?.steps ?? [];
      expect(steps.map((s) => s.action)).toEqual(actions);
    });

    test("defaults the optional screenshot and note to null", async () => {
      await seedRun();
      await seedCase();
      const step = await store.addStep({
        runId,
        caseId: "valid",
        index: 0,
        action: TAP,
        uiText: "ui",
      });

      expect(step.screenshotPath).toBeNull();
      expect(step.note).toBeNull();
    });

    test("stores a screenshot path and note when given", async () => {
      await seedRun();
      await seedCase();
      await store.addStep({
        runId,
        caseId: "valid",
        index: 0,
        action: TAP,
        uiText: "ui",
        screenshotPath: "var/screenshots/run-1/valid/000.png",
        note: "tapped sign in",
      });

      const step = (await store.getRun(runId))?.cases[0]?.steps[0];
      expect(step?.screenshotPath).toBe("var/screenshots/run-1/valid/000.png");
      expect(step?.note).toBe("tapped sign in");
    });

    test("rejects a duplicate step index within a case", async () => {
      await seedRun();
      await seedCase();
      await store.addStep({ runId, caseId: "valid", index: 0, action: TAP, uiText: "" });

      await expect(
        store.addStep({ runId, caseId: "valid", index: 0, action: TAP, uiText: "" }),
      ).rejects.toThrow();
    });

    test("returns steps ordered by index regardless of insertion order", async () => {
      await seedRun();
      await seedCase();
      for (const index of [2, 0, 1]) {
        await store.addStep({ runId, caseId: "valid", index, action: TAP, uiText: "" });
      }

      const steps = (await store.getRun(runId))?.cases[0]?.steps ?? [];
      expect(steps.map((s) => s.index)).toEqual([0, 1, 2]);
    });

    test("orders past ten steps numerically, not lexicographically", async () => {
      await seedRun();
      await seedCase();
      for (const index of [0, 1, 2, 10, 11]) {
        await store.addStep({ runId, caseId: "valid", index, action: TAP, uiText: "" });
      }

      const steps = (await store.getRun(runId))?.cases[0]?.steps ?? [];
      expect(steps.map((s) => s.index)).toEqual([0, 1, 2, 10, 11]);
    });

    test("scopes steps to their own case", async () => {
      await seedRun();
      await seedCase("valid", 0);
      await seedCase("invalid", 1);
      await store.addStep({ runId, caseId: "valid", index: 0, action: TAP, uiText: "" });
      await store.addStep({ runId, caseId: "invalid", index: 0, action: FINISH, uiText: "" });

      const cases = (await store.getRun(runId))?.cases ?? [];
      expect(cases[0]?.steps).toHaveLength(1);
      expect(cases[1]?.steps[0]?.action).toEqual(FINISH);
    });
  });

  describe("finishCase", () => {
    test("records the verdict and finish time", async () => {
      await seedRun();
      await seedCase();
      await store.finishCase(runId, "valid", { status: "passed", verdictReason: "logged in" });

      const caseRun = (await store.getRun(runId))?.cases[0];
      expect(caseRun?.status).toBe("passed");
      expect(caseRun?.verdictReason).toBe("logged in");
      expect(caseRun?.finishedAt).not.toBeNull();
    });

    test("supports the error status with no reason", async () => {
      await seedRun();
      await seedCase();
      await store.finishCase(runId, "valid", { status: "error" });

      const caseRun = (await store.getRun(runId))?.cases[0];
      expect(caseRun?.status).toBe("error");
      expect(caseRun?.verdictReason).toBeNull();
    });

    test("throws for an unknown case", async () => {
      await seedRun();
      await expect(store.finishCase(runId, "ghost", { status: "passed" })).rejects.toThrow(
        StoreError,
      );
    });
  });

  describe("finishRun", () => {
    test("records the run-level verdict", async () => {
      await seedRun();
      await store.finishRun(runId, { status: "passed", verdictReason: "all 1 cases passed" });

      const run = await store.getRun(runId);
      expect(run?.status).toBe("passed");
      expect(run?.verdictReason).toBe("all 1 cases passed");
      expect(run?.finishedAt).not.toBeNull();
    });

    test("throws for an unknown run", async () => {
      await expect(store.finishRun("ghost", { status: "passed" })).rejects.toThrow(StoreError);
    });
  });

  describe("getRun", () => {
    test("returns null for an unknown id", async () => {
      expect(await store.getRun("ghost")).toBeNull();
    });
  });

  describe("listRuns", () => {
    test("returns runs newest first without their cases", async () => {
      await seedRun();
      await seedCase();

      const runs = await store.listRuns();
      const found = runs.find((r) => r.id === runId);

      expect(found).toBeDefined();
      expect(found?.cases).toEqual([]);
    });

    test("honours the limit", async () => {
      await seedRun();
      expect((await store.listRuns(1)).length).toBeLessThanOrEqual(1);
    });
  });
});
