import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Action } from "@gemma-e2e/core";
import { nextAcceptedAt, Store, StoreError } from "./store.ts";

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

/**
 * What keeps a batch in the order it was asked for. `listRuns` sorts by
 * `startedAt` alone, so two runs sharing a timestamp are ordered by nothing --
 * and the sidebar would show the same batch differently on each refetch.
 */
describe("nextAcceptedAt", () => {
  test("uses the clock when it has moved on since the last run was accepted", () => {
    expect(nextAcceptedAt("2026-08-04T10:00:01.000Z", "2026-08-04T10:00:00.000Z")).toBe(
      "2026-08-04T10:00:01.000Z",
    );
  });

  test("takes the clock as-is for the first run, having nothing to be after", () => {
    expect(nextAcceptedAt("2026-08-04T10:00:00.000Z", null)).toBe("2026-08-04T10:00:00.000Z");
  });

  test("separates two runs accepted within the same millisecond, so their order is fixed", () => {
    const same = "2026-08-04T10:00:00.000Z";

    expect(nextAcceptedAt(same, same)).toBe("2026-08-04T10:00:00.001Z");
  });

  test("keeps a batch strictly increasing however fast it is accepted", () => {
    const frozen = "2026-08-04T10:00:00.000Z";
    const accepted: string[] = [];
    let previous: string | null = null;

    for (let i = 0; i < 5; i += 1) {
      previous = nextAcceptedAt(frozen, previous);
      accepted.push(previous);
    }

    expect(accepted).toEqual([...accepted].sort());
    expect(new Set(accepted).size).toBe(accepted.length);
  });

  test("still moves forward when the clock steps backwards, rather than reordering the history", () => {
    const result = nextAcceptedAt("2026-08-04T09:59:59.000Z", "2026-08-04T10:00:00.000Z");

    expect(result).toBe("2026-08-04T10:00:00.001Z");
  });

  test("stays a parseable ISO instant, which every consumer hands to new Date()", () => {
    const result = nextAcceptedAt("2026-08-04T10:00:00.000Z", "2026-08-04T10:00:00.000Z");

    expect(Number.isNaN(Date.parse(result))).toBe(false);
  });
});

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

  describe("enqueueRun", () => {
    test("makes the run fetchable before anything has touched a device", async () => {
      await store.enqueueRun({ id: runId, scenarioId: "login", title: "Login" });

      const stored = await store.getRun(runId);
      expect(stored?.status).toBe("queued");
      expect(stored?.scenarioId).toBe("login");
      expect(stored?.title).toBe("Login");
    });

    test("leaves the run unfinished and without cases", async () => {
      const run = await store.enqueueRun({ id: runId, scenarioId: "login", title: "Login" });

      expect(run.finishedAt).toBeNull();
      expect(run.verdictReason).toBeNull();
      expect(run.cases).toEqual([]);
      expect(run.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    test("rejects a duplicate run id", async () => {
      await store.enqueueRun({ id: runId, scenarioId: "login", title: "Login" });

      await expect(
        store.enqueueRun({ id: runId, scenarioId: "login", title: "Login" }),
      ).rejects.toThrow();
    });
  });

  describe("beginRun", () => {
    test("flips an enqueued run to running", async () => {
      await store.enqueueRun({ id: runId, scenarioId: "login", title: "Login" });
      const begun = await store.beginRun({ id: runId, scenarioId: "login", title: "Login" });

      expect(begun.status).toBe("running");
      expect((await store.getRun(runId))?.status).toBe("running");
    });

    test("keeps the time the run was accepted, so a batch stays in the order it was asked for", async () => {
      const queued = await store.enqueueRun({ id: runId, scenarioId: "login", title: "Login" });
      const begun = await store.beginRun({ id: runId, scenarioId: "login", title: "Login" });

      expect(begun.startedAt).toBe(queued.startedAt);
      expect((await store.getRun(runId))?.startedAt).toBe(queued.startedAt);
    });

    test("creates a run that was never enqueued, for callers that bypass the queue", async () => {
      const begun = await store.beginRun({ id: runId, scenarioId: "login", title: "Login" });

      expect(begun.status).toBe("running");

      const stored = await store.getRun(runId);
      expect(stored?.status).toBe("running");
      expect(stored?.scenarioId).toBe("login");
      expect(stored?.finishedAt).toBeNull();
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
    test("round-trips review evidence, persona snapshot and findings", async () => {
      await seedRun();
      await seedCase();
      const accessibilityReview = {
        status: "completed" as const,
        model: "vision-model",
        screenshotPath: "run/valid/000-review.png",
        personas: [{ id: "near-text", label: "老眼", description: "小さい文字が読みにくい" }],
        reviews: [
          {
            personaId: "near-text",
            findings: [
              {
                category: "text_size" as const,
                location: "Footer",
                reason: "Small text",
                suggestion: "Enlarge text",
              },
            ],
          },
        ],
      };
      await store.addStep({
        runId,
        caseId: "valid",
        index: 0,
        action: TAP,
        uiText: "",
        accessibilityReview,
      });
      expect((await store.getRun(runId))?.cases[0]?.steps[0]?.accessibilityReview).toEqual(
        accessibilityReview,
      );
    });
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

    test("stores the screen recording's path", async () => {
      await seedRun();
      await seedCase();
      await store.finishCase(runId, "valid", {
        status: "passed",
        videoPath: "/var/videos/run/valid.mp4",
      });

      expect((await store.getRun(runId))?.cases[0]?.videoPath).toBe("/var/videos/run/valid.mp4");
    });

    test("leaves videoPath null when the case was not recorded", async () => {
      await seedRun();
      await seedCase();
      await store.finishCase(runId, "valid", { status: "passed" });

      expect((await store.getRun(runId))?.cases[0]?.videoPath).toBeNull();
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

  /**
   * What a restart owes the reader. The queue keeps its pending jobs in memory,
   * so a process that goes away takes them with it while their documents stay
   * where they were -- and a `queued` document with no executor behind it is a
   * dashboard saying "waiting for the device" about work that will never start.
   *
   * The sweep runs across the whole collection, so these tests own every run
   * they create and delete all of them, rather than relying on the single-id
   * cleanup the surrounding suite uses.
   */
  describe("settleOrphanedRuns", () => {
    const REASON = "the server restarted before this run finished";
    let extraIds: string[] = [];

    async function orphan(status: "queued" | "running"): Promise<string> {
      const id = `run-${crypto.randomUUID()}`;
      extraIds.push(id);
      const input = { id, scenarioId: "login", title: "Login" };
      const isQueued = status === "queued";
      if (isQueued) {
        await store.enqueueRun(input);
        return id;
      }
      await store.createRun(input);
      return id;
    }

    beforeEach(() => {
      extraIds = [];
    });

    afterEach(async () => {
      await Promise.all(extraIds.map((id) => store.deleteRun(id)));
    });

    test("closes a run the restart left waiting for the device, so nothing waits on it forever", async () => {
      const id = await orphan("queued");

      const settled = await store.settleOrphanedRuns(REASON);

      expect(settled).toContain(id);
      const stored = await store.getRun(id);
      expect(stored?.status).toBe("error");
      expect(stored?.verdictReason).toBe(REASON);
      expect(stored?.finishedAt).not.toBeNull();
    });

    test("closes a run that was mid-flight, whose executor died with the process", async () => {
      const id = await orphan("running");

      await store.settleOrphanedRuns(REASON);

      expect((await store.getRun(id))?.status).toBe("error");
    });

    test("leaves a run that already reached a verdict untouched", async () => {
      const id = await orphan("running");
      await store.finishRun(id, { status: "passed", verdictReason: "all 1 cases passed" });

      const settled = await store.settleOrphanedRuns(REASON);

      expect(settled).not.toContain(id);
      const stored = await store.getRun(id);
      expect(stored?.status).toBe("passed");
      expect(stored?.verdictReason).toBe("all 1 cases passed");
    });

    test("is idempotent, so a second restart finds nothing left to settle", async () => {
      const id = await orphan("queued");
      await store.settleOrphanedRuns(REASON);

      const again = await store.settleOrphanedRuns(REASON);

      expect(again).not.toContain(id);
    });

    test("settles every orphan of a batch, not just the one that was running", async () => {
      const ids = [await orphan("running"), await orphan("queued"), await orphan("queued")];

      const settled = await store.settleOrphanedRuns(REASON);

      for (const id of ids) {
        expect(settled).toContain(id);
        expect((await store.getRun(id))?.status).toBe("error");
      }
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

    test("keeps a batch in the order it was accepted, even enqueued as fast as possible", async () => {
      const ids = [
        `run-${crypto.randomUUID()}`,
        `run-${crypto.randomUUID()}`,
        `run-${crypto.randomUUID()}`,
      ];
      try {
        for (const id of ids) {
          await store.enqueueRun({ id, scenarioId: "login", title: "Login" });
        }

        // Newest first, so the batch reads back-to-front: the run accepted last
        // is the one at the top of the rail.
        const listed = (await store.listRuns())
          .map((run) => run.id)
          .filter((id) => ids.includes(id));
        expect(listed).toEqual([...ids].reverse());
      } finally {
        await Promise.all(ids.map((id) => store.deleteRun(id)));
      }
    });
  });
});
