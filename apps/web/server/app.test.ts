import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CaseRun, Run, Step } from "@gemma-e2e/core";
import { createLogger, type LogEvent } from "@gemma-e2e/logger";
import type { RunEvent } from "@gemma-e2e/agent";
import { RunEventBus } from "./bus.ts";
import { createApp, type StartRunInput, type StoreReader } from "./app.ts";

const LOGIN_YAML = `title: Login
cases:
  - id: valid
    prompt: Check that a user can log in.
    maxSteps: 5
  - id: invalid
    prompt: Check that a wrong password is rejected.
`;

class FakeStore implements StoreReader {
  readonly runs = new Map<string, Run>();

  add(run: Run): Run {
    this.runs.set(run.id, run);
    return run;
  }

  async listRuns(): Promise<Run[]> {
    return [...this.runs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async getRun(id: string): Promise<Run | null> {
    return this.runs.get(id) ?? null;
  }
}

function step(index: number, overrides: Partial<Step> = {}): Step {
  return {
    runId: "run-1",
    caseId: "valid",
    index,
    action: { type: "tap", ref: index },
    uiText: `[${index}] Button`,
    screenshotPath: `/tmp/shots/${index}.png`,
    note: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function caseRun(overrides: Partial<CaseRun> = {}): CaseRun {
  return {
    runId: "run-1",
    caseId: "valid",
    order: 0,
    title: "Logs in",
    prompt: "Check that a user can log in.",
    model: "gemma-4-12b",
    status: "passed",
    verdictReason: "greeting is visible",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:01:00.000Z",
    steps: [],
    ...overrides,
  };
}

function run(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    scenarioId: "login",
    title: "Login",
    status: "passed",
    verdictReason: "all 1 cases passed",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:01:00.000Z",
    cases: [],
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
  test("lists the scenarios on disk with their cases", async () => {
    const res = await harness().request("/api/scenarios");

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      scenarios: { id: string; title: string; cases: { id: string }[] }[];
    };
    expect(body.scenarios).toHaveLength(1);
    expect(body.scenarios[0]?.id).toBe("login");
    expect(body.scenarios[0]?.cases.map((c) => c.id)).toEqual(["valid", "invalid"]);
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

describe("GET /api/models", () => {
  test("returns the models the endpoint offers", async () => {
    const app = createApp({
      store,
      scenariosDir,
      startRun: () => {},
      listModels: async () => [{ id: "gemma-4-12b" }, { id: "gemma-4-e4b" }],
    });

    const res = await app.request("/api/models");

    expect(res.status).toBe(200);
    const body = (await res.json()) as { models: { id: string }[] };
    expect(body.models.map((m) => m.id)).toEqual(["gemma-4-12b", "gemma-4-e4b"]);
  });

  test("reports 503 when no model source is configured", async () => {
    const res = await harness().request("/api/models");

    expect(res.status).toBe(503);
  });

  test("reports 503 when the model server is unreachable", async () => {
    const app = createApp({
      store,
      scenariosDir,
      startRun: () => {},
      listModels: async () => {
        throw new Error("connection refused");
      },
    });

    const res = await app.request("/api/models");

    expect(res.status).toBe(503);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "connection refused" });
  });
});

describe("POST /api/runs", () => {
  test("accepts a scenario id and schedules every case in that scenario", async () => {
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
    expect(started[0]?.scenario.cases.map((c) => c.id)).toEqual(["valid", "invalid"]);
  });

  test("accepts an ad-hoc prompt and schedules a one-case scenario", async () => {
    const res = await harness().request("/api/runs", {
      method: "POST",
      body: JSON.stringify({ prompt: "open settings", title: "Settings smoke" }),
      headers: { "content-type": "application/json" },
    });

    expect(res.status).toBe(202);
    expect(started[0]?.scenario.title).toBe("Settings smoke");
    expect(started[0]?.scenario.cases).toHaveLength(1);
    expect(started[0]?.scenario.cases[0]?.prompt).toBe("open settings");
    expect(started[0]?.scenario.cases[0]?.maxSteps).toBeGreaterThan(0);
  });

  test("carries an ad-hoc model choice onto the case", async () => {
    await harness().request("/api/runs", {
      method: "POST",
      body: JSON.stringify({ prompt: "open settings", model: "gemma-4-e4b" }),
      headers: { "content-type": "application/json" },
    });

    expect(started[0]?.scenario.cases[0]?.model).toBe("gemma-4-e4b");
  });

  test("leaves the model unset when the ad-hoc body names none", async () => {
    await harness().request("/api/runs", {
      method: "POST",
      body: JSON.stringify({ prompt: "open settings" }),
      headers: { "content-type": "application/json" },
    });

    expect(started[0]?.scenario.cases[0]?.model).toBeUndefined();
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
  test("returns the run with its cases and their steps", async () => {
    store.add(run({ cases: [caseRun({ steps: [step(0), step(1)] })] }));

    const res = await harness().request("/api/runs/run-1");

    expect(res.status).toBe(200);
    const body = (await res.json()) as { run: Run };
    expect(body.run.status).toBe("passed");
    expect(body.run.cases).toHaveLength(1);
    expect(body.run.cases[0]?.steps.map((s) => s.index)).toEqual([0, 1]);
  });

  test("returns 404 for an unknown run", async () => {
    const res = await harness().request("/api/runs/nope");

    expect(res.status).toBe(404);
  });
});

/** Reads an SSE body until the stream closes, returning the parsed payloads. */
async function collectSse(res: Response): Promise<{ type: string; caseId?: string }[]> {
  const text = await res.text();
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice("data: ".length)) as { type: string; caseId?: string });
}

describe("GET /api/runs/:id/events", () => {
  test("returns 404 for an unknown run", async () => {
    const res = await harness().request("/api/runs/nope/events");

    expect(res.status).toBe(404);
  });

  test("replays each case with its steps and a terminal event", async () => {
    store.add(
      run({
        status: "failed",
        verdictReason: "1 of 1 cases did not pass",
        cases: [caseRun({ status: "failed", verdictReason: "no greeting", steps: [step(0)] })],
      }),
    );

    const res = await harness().request("/api/runs/run-1/events");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const events = await collectSse(res);
    expect(events.map((e) => e.type)).toEqual([
      "case_started",
      "step_recorded",
      "case_finished",
      "run_finished",
    ]);
    expect(events[3]).toMatchObject({ status: "failed" });
  });

  test("tags every replayed per-case event with its caseId", async () => {
    store.add(
      run({
        cases: [
          caseRun({ caseId: "valid", order: 0, steps: [step(0)] }),
          caseRun({ caseId: "invalid", order: 1, steps: [step(0, { caseId: "invalid" })] }),
        ],
      }),
    );

    const events = await collectSse(await harness().request("/api/runs/run-1/events"));

    const stepEvents = events.filter((e) => e.type === "step_recorded");
    expect(stepEvents.map((e) => e.caseId)).toEqual(["valid", "invalid"]);
  });

  test("omits case_finished for a case still running", async () => {
    store.add(
      run({
        status: "running",
        finishedAt: null,
        cases: [caseRun({ status: "running", finishedAt: null, verdictReason: null })],
      }),
    );
    const bus = new RunEventBus();

    const res = await harness(bus).request("/api/runs/run-1/events");
    void (async () => {
      while (bus.listenerCount("run-1") === 0) {
        await Bun.sleep(1);
      }
      bus.publish({ type: "run_finished", runId: "run-1", status: "passed", reason: "done" });
    })();

    const events = await collectSse(res);
    expect(events.map((e) => e.type)).toEqual(["case_started", "run_finished"]);
  });

  test("replays existing steps then streams live events until the run finishes", async () => {
    const bus = new RunEventBus();
    store.add(
      run({
        status: "running",
        finishedAt: null,
        cases: [caseRun({ status: "running", finishedAt: null, steps: [step(0)] })],
      }),
    );

    const res = await harness(bus).request("/api/runs/run-1/events");
    expect(res.status).toBe(200);

    // The handler subscribes while the response body is being consumed, so the
    // live events have to be published from a task that runs concurrently with
    // the read below rather than before it.
    const live: RunEvent[] = [
      { type: "step_recorded", runId: "run-1", caseId: "valid", step: step(1) },
      { type: "case_finished", runId: "run-1", caseId: "valid", status: "passed", reason: "done" },
      { type: "run_finished", runId: "run-1", status: "passed", reason: "all 1 cases passed" },
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
    expect(events.map((e) => e.type)).toEqual([
      "case_started",
      "step_recorded",
      "step_recorded",
      "case_finished",
      "run_finished",
    ]);
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

  test("emits one http.request line per request, with method, path and status", async () => {
    const log = capture();
    const app = createApp({
      store: new FakeStore(),
      scenariosDir,
      startRun: () => {},
      logger: log.logger,
    });

    await app.request("/api/scenarios");

    const request = log.events().find((e) => e.event === "http.request");
    expect(request).toMatchObject({
      level: "info",
      method: "GET",
      path: "/api/scenarios",
      status: 200,
    });
    expect(typeof request?.["durationMs"]).toBe("number");
  });

  test("logs the failing status for a request that 404s", async () => {
    const log = capture();
    const app = createApp({
      store: new FakeStore(),
      scenariosDir,
      startRun: () => {},
      logger: log.logger,
    });

    await app.request("/api/runs/nope");

    expect(log.events().find((e) => e.event === "http.request")).toMatchObject({
      path: "/api/runs/nope",
      status: 404,
    });
  });

  test("reports a scenario directory that cannot be read at error level", async () => {
    const log = capture();
    const app = createApp({
      store: new FakeStore(),
      scenariosDir: join(scenariosDir, "does-not-exist"),
      startRun: () => {},
      logger: log.logger,
    });

    await app.request("/api/scenarios");

    expect(log.events().find((e) => e.event === "http.scenarios_failed")).toMatchObject({
      level: "error",
    });
  });

  test("warns when the model endpoint cannot be reached", async () => {
    const log = capture();
    const app = createApp({
      store: new FakeStore(),
      scenariosDir,
      startRun: () => {},
      logger: log.logger,
      listModels: async () => {
        throw new Error("connection refused");
      },
    });

    await app.request("/api/models");

    expect(log.events().find((e) => e.event === "models.unavailable")).toMatchObject({
      level: "warn",
    });
  });

  test("tags SSE lifecycle lines with the runId", async () => {
    const log = capture();
    const store = new FakeStore();
    store.add(run({ status: "passed" }));
    const app = createApp({ store, scenariosDir, startRun: () => {}, logger: log.logger });

    const res = await app.request("/api/runs/run-1/events");
    await res.text();

    expect(log.events().find((e) => e.event === "sse.connected")).toMatchObject({
      runId: "run-1",
      status: "passed",
    });
  });

  test("writes nothing when no logger is injected", async () => {
    const app = createApp({ store: new FakeStore(), scenariosDir, startRun: () => {} });

    const res = await app.request("/api/scenarios");

    expect(res.status).toBe(200);
  });
});
