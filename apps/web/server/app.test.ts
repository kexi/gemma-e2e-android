import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Run, Step } from "@gemma-e2e/core";
import type { RunEvent } from "@gemma-e2e/agent";
import { RunEventBus } from "./bus.ts";
import { createApp, type StartRunInput, type StoreReader } from "./app.ts";

const LOGIN_YAML = `title: Login
prompt: Check that a user can log in.
maxSteps: 5
`;

class FakeStore implements StoreReader {
  readonly runs = new Map<string, Run>();

  add(run: Run): Run {
    this.runs.set(run.id, run);
    return run;
  }

  listRuns(): Run[] {
    return [...this.runs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  getRun(id: string): Run | null {
    return this.runs.get(id) ?? null;
  }
}

function step(index: number, overrides: Partial<Step> = {}): Step {
  return {
    id: index + 1,
    runId: "run-1",
    index,
    action: { type: "tap", ref: index },
    uiText: `[${index}] Button`,
    screenshotPath: `/tmp/shots/${index}.png`,
    note: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function run(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    scenarioId: "login",
    title: "Login",
    prompt: "Check that a user can log in.",
    status: "passed",
    verdictReason: "greeting is visible",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:01:00.000Z",
    steps: [],
    ...overrides,
  };
}

let scenariosDir: string;
let store: FakeStore;
let started: StartRunInput[];

beforeEach(async () => {
  scenariosDir = await mkdtemp(join(tmpdir(), "gemma-scenarios-"));
  await writeFile(join(scenariosDir, "login.yaml"), LOGIN_YAML, "utf8");
  store = new FakeStore();
  started = [];
});

afterEach(async () => {
  await rm(scenariosDir, { recursive: true, force: true });
});

function harness(bus?: RunEventBus) {
  return createApp({
    store,
    scenariosDir,
    startRun: (input) => started.push(input),
    ...(bus === undefined ? {} : { bus }),
  });
}

describe("GET /api/scenarios", () => {
  test("lists the scenarios on disk with their prompts", async () => {
    const res = await harness().request("/api/scenarios");

    expect(res.status).toBe(200);
    const body = (await res.json()) as { scenarios: { id: string; title: string }[] };
    expect(body.scenarios).toHaveLength(1);
    expect(body.scenarios[0]?.id).toBe("login");
    expect(body.scenarios[0]?.title).toBe("Login");
  });

  test("reports a missing directory as a server error rather than crashing", async () => {
    const app = createApp({
      store,
      scenariosDir: join(scenariosDir, "does-not-exist"),
      startRun: () => {},
    });

    const res = await app.request("/api/scenarios");

    expect(res.status).toBe(500);
  });
});

describe("POST /api/runs", () => {
  test("accepts a scenario id and schedules that scenario", async () => {
    const res = await harness().request("/api/runs", {
      method: "POST",
      body: JSON.stringify({ scenarioId: "login" }),
      headers: { "content-type": "application/json" },
    });

    expect(res.status).toBe(202);
    const body = (await res.json()) as { runId: string };
    expect(body.runId).toBeTruthy();

    expect(started).toHaveLength(1);
    expect(started[0]?.runId).toBe(body.runId);
    expect(started[0]?.scenario.id).toBe("login");
    expect(started[0]?.scenario.prompt).toBe("Check that a user can log in.");
  });

  test("accepts an ad-hoc prompt and schedules a synthetic scenario", async () => {
    const res = await harness().request("/api/runs", {
      method: "POST",
      body: JSON.stringify({ prompt: "open settings", title: "Settings smoke" }),
      headers: { "content-type": "application/json" },
    });

    expect(res.status).toBe(202);
    expect(started[0]?.scenario.title).toBe("Settings smoke");
    expect(started[0]?.scenario.prompt).toBe("open settings");
    expect(started[0]?.scenario.maxSteps).toBeGreaterThan(0);
  });

  test("rejects a body with neither a scenario id nor a prompt", async () => {
    const res = await harness().request("/api/runs", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "content-type": "application/json" },
    });

    expect(res.status).toBe(400);
    expect(started).toHaveLength(0);
  });

  test("rejects a non-JSON body", async () => {
    const res = await harness().request("/api/runs", {
      method: "POST",
      body: "not json",
      headers: { "content-type": "application/json" },
    });

    expect(res.status).toBe(400);
  });

  test("returns 404 for a scenario id that is not on disk", async () => {
    const res = await harness().request("/api/runs", {
      method: "POST",
      body: JSON.stringify({ scenarioId: "checkout" }),
      headers: { "content-type": "application/json" },
    });

    expect(res.status).toBe(404);
    expect(started).toHaveLength(0);
  });
});

describe("GET /api/runs", () => {
  test("returns the run history newest first", async () => {
    store.add(run({ id: "older", startedAt: "2026-01-01T00:00:00.000Z" }));
    store.add(run({ id: "newer", startedAt: "2026-02-01T00:00:00.000Z" }));

    const res = await harness().request("/api/runs");

    expect(res.status).toBe(200);
    const body = (await res.json()) as { runs: Run[] };
    expect(body.runs.map((r) => r.id)).toEqual(["newer", "older"]);
  });
});

describe("GET /api/runs/:id", () => {
  test("returns the run with its steps", async () => {
    store.add(run({ steps: [step(0), step(1)] }));

    const res = await harness().request("/api/runs/run-1");

    expect(res.status).toBe(200);
    const body = (await res.json()) as { run: Run };
    expect(body.run.status).toBe("passed");
    expect(body.run.steps.map((s) => s.index)).toEqual([0, 1]);
  });

  test("returns 404 for an unknown run", async () => {
    const res = await harness().request("/api/runs/nope");

    expect(res.status).toBe(404);
  });
});

/** Reads an SSE body until the stream closes, returning the parsed payloads. */
async function collectSse(res: Response): Promise<{ type: string }[]> {
  const text = await res.text();
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice("data: ".length)) as { type: string });
}

describe("GET /api/runs/:id/events", () => {
  test("returns 404 for an unknown run", async () => {
    const res = await harness().request("/api/runs/nope/events");

    expect(res.status).toBe(404);
  });

  test("replays recorded steps and a terminal event for a finished run", async () => {
    store.add(run({ status: "failed", verdictReason: "no greeting", steps: [step(0), step(1)] }));

    const res = await harness().request("/api/runs/run-1/events");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const events = await collectSse(res);
    expect(events.map((e) => e.type)).toEqual(["step_recorded", "step_recorded", "run_finished"]);
    expect(events[2]).toMatchObject({ status: "failed", reason: "no greeting" });
  });

  test("replays existing steps then streams live events until the run finishes", async () => {
    const bus = new RunEventBus();
    store.add(run({ status: "running", finishedAt: null, steps: [step(0)] }));

    const res = await harness(bus).request("/api/runs/run-1/events");
    expect(res.status).toBe(200);

    // The handler subscribes while the response body is being consumed, so the
    // live events have to be published from a task that runs concurrently with
    // the read below rather than before it.
    const live: RunEvent[] = [
      { type: "step_recorded", runId: "run-1", step: step(1) },
      { type: "run_finished", runId: "run-1", status: "passed", reason: "done" },
    ];
    void (async () => {
      while (bus.listenerCount("run-1") === 0) {
        await Bun.sleep(1);
      }
      for (const event of live) {
        bus.publish(event);
      }
    })();

    const events = await collectSse(res);
    expect(events.map((e) => e.type)).toEqual(["step_recorded", "step_recorded", "run_finished"]);
  });
});
