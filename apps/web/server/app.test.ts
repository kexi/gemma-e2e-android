import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Action, CaseRun, Run, Scenario, Step } from "@gemma-e2e/core";
import { createLogger, type LogEvent } from "@gemma-e2e/logger";
import type { RunEvent } from "@gemma-e2e/agent";
import { RunEventBus } from "./bus.ts";
import {
  createApp,
  type DeviceSource,
  movesTheHistory,
  type StartRunInput,
  type StoreReader,
} from "./app.ts";

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

/** The scenario an event carries; nothing under test reads past its shape. */
const SCENARIO: Scenario = {
  id: "login",
  title: "Login",
  tags: [],
  cases: [{ id: "valid", prompt: "Check that a user can log in.", maxSteps: 5 }],
};

const TAP: Action = { type: "tap", ref: 0 };

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
    videoPath: null,
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
    startRun: async (input) => {
      started.push(input);
    },
    ...(bus === undefined ? {} : { bus }),
  });
}

/** A dashboard whose store refuses the write, to pin what the API answers then. */
function failingHarness(failAfter: number) {
  return createApp({
    store,
    scenariosDir,
    startRun: async (input) => {
      const hasRoomLeft = started.length < failAfter;
      if (!hasRoomLeft) {
        throw new Error("firestore is unavailable");
      }
      started.push(input);
    },
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
      startRun: async () => {},
    });

    const res = await app.request("/api/scenarios");

    expect(res.status).toBe(500);
  });
});

describe("POST /api/scenarios", () => {
  function post(body: unknown) {
    return harness().request("/api/scenarios", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  const CHECKOUT = {
    id: "checkout",
    title: "Checkout",
    target: {
      platform: "android",
      package: "dev.kexi.gemmae2e.example",
      activity: ".MainActivity",
    },
    cases: [{ id: "buys-a-bean", title: "Buys a bean", prompt: "Add a bean and pay." }],
  };

  test("writes the scenario to scenarios/<id>.yaml so the listing picks it up", async () => {
    const res = await post(CHECKOUT);

    expect(res.status).toBe(201);
    const listed = (await (await harness().request("/api/scenarios")).json()) as {
      scenarios: { id: string; title: string; target?: { package: string } }[];
    };
    const created = listed.scenarios.find((s) => s.id === "checkout");
    expect(created).toMatchObject({
      title: "Checkout",
      target: { platform: "android", package: CHECKOUT.target.package },
    });
  });

  test("omits the id from the file, because the loader takes it from the filename", async () => {
    await post(CHECKOUT);

    const written = await readFile(join(scenariosDir, "checkout.yaml"), "utf8");
    expect(written).not.toContain("id: checkout");
    expect(written).toContain("title: Checkout");
    // Prompts fold as `>-`, the shape the committed scenarios already use.
    expect(written).toContain("prompt: >-");
  });

  test("defaults maxSteps so a case created without a budget is still bounded", async () => {
    await post(CHECKOUT);

    const listed = (await (await harness().request("/api/scenarios")).json()) as {
      scenarios: { id: string; cases: { maxSteps: number }[] }[];
    };
    expect(listed.scenarios.find((s) => s.id === "checkout")?.cases[0]?.maxSteps).toBe(20);
  });

  test("refuses to overwrite an existing scenario file", async () => {
    const res = await post({ id: "login", title: "Rewritten", cases: CHECKOUT.cases });

    expect(res.status).toBe(409);
    // The committed file is untouched: a 409 must not be a partial write.
    expect(await readFile(join(scenariosDir, "login.yaml"), "utf8")).toBe(LOGIN_YAML);
  });

  test("rejects a body the scenario schema does not accept", async () => {
    const res = await post({ id: "empty", title: "No cases", cases: [] });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("at least one case");
  });

  test("rejects an id that would escape the scenarios directory", async () => {
    const res = await post({ ...CHECKOUT, id: "../escape" });

    expect(res.status).toBe(400);
    expect(await Bun.file(join(scenariosDir, "../escape.yaml")).exists()).toBe(false);
  });

  test("rejects two cases sharing an id, which would collide in Firestore", async () => {
    const res = await post({
      ...CHECKOUT,
      cases: [
        { id: "same", prompt: "First." },
        { id: "same", prompt: "Second." },
      ],
    });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("duplicate case id");
  });

  test("rejects a non-JSON body", async () => {
    const res = await harness().request("/api/scenarios", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });

    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/scenarios/:id", () => {
  function del(id: string) {
    return harness().request(`/api/scenarios/${id}`, { method: "DELETE" });
  }

  test("removes the file so the listing no longer reports the scenario", async () => {
    const res = await del("login");

    expect(res.status).toBe(204);
    const listed = (await (await harness().request("/api/scenarios")).json()) as {
      scenarios: { id: string }[];
    };
    expect(listed.scenarios.map((one) => one.id)).not.toContain("login");
    expect(await Bun.file(join(scenariosDir, "login.yaml")).exists()).toBe(false);
  });

  test("reports a scenario that is not on disk as 404", async () => {
    const res = await del("nope");

    expect(res.status).toBe(404);
  });

  test("rejects an id that would escape the scenarios directory", async () => {
    await writeFile(join(scenariosDir, "..", "escape.yaml"), LOGIN_YAML, "utf8");

    const res = await del("..%2Fescape");

    expect(res.status).toBe(400);
    expect(await Bun.file(join(scenariosDir, "../escape.yaml")).exists()).toBe(true);
    await rm(join(scenariosDir, "..", "escape.yaml"), { force: true });
  });
});

describe("PUT /api/scenarios/:id", () => {
  function put(id: string, body: unknown) {
    return harness().request(`/api/scenarios/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  const EDITED_LOGIN = {
    title: "Login (revised)",
    target: { platform: "android", package: "dev.kexi.gemmae2e.example" },
    cases: [{ id: "valid", title: "Logs in", prompt: "Check that a user can log in." }],
  };

  test("rewrites the file so the listing reports the edited scenario", async () => {
    const res = await put("login", EDITED_LOGIN);

    expect(res.status).toBe(200);
    const listed = (await (await harness().request("/api/scenarios")).json()) as {
      scenarios: { id: string; title: string; cases: { id: string }[] }[];
    };
    const edited = listed.scenarios.find((s) => s.id === "login");
    expect(edited).toMatchObject({ title: "Login (revised)" });
    expect(edited?.cases.map((one) => one.id)).toEqual(["valid"]);
  });

  test("accepts a body that repeats the id from the path", async () => {
    const res = await put("login", { ...EDITED_LOGIN, id: "login" });

    expect(res.status).toBe(200);
  });

  test("writes the same house style as a scenario created through POST", async () => {
    await put("login", EDITED_LOGIN);
    await harness().request("/api/scenarios", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...EDITED_LOGIN, id: "twin" }),
    });

    const edited = await readFile(join(scenariosDir, "login.yaml"), "utf8");
    const created = await readFile(join(scenariosDir, "twin.yaml"), "utf8");
    expect(edited).toBe(created);
    // The id stays out of the file, and prose still folds as `>-`.
    expect(edited).not.toContain("id: login");
    expect(edited).toContain("prompt: >-");
  });

  test("round-trips tags through an edit, so a PUT does not silently drop them", async () => {
    // `SCENARIO_KEYS` is the filter the merge rebuilds the mapping through, so
    // a key missing from that list would vanish from the file here with no
    // error anywhere -- the same failure mode the comment-preservation tests
    // above guard for prose.
    const res = await put("login", { ...EDITED_LOGIN, tags: ["smoke", "auth"] });

    expect(res.status).toBe(200);
    const written = await readFile(join(scenariosDir, "login.yaml"), "utf8");
    expect(written).toContain("tags:");
    const listed = (await (await harness().request("/api/scenarios")).json()) as {
      scenarios: { id: string; tags: string[] }[];
    };
    expect(listed.scenarios.find((one) => one.id === "login")?.tags).toEqual(["smoke", "auth"]);
  });

  test("keeps the tags a later edit does not mention out of the file", async () => {
    // Tags default to `[]`, so an edit that omits them means "no tags" rather
    // than "leave them alone"; the point is that the key does not linger with
    // a stale value.
    await put("login", { ...EDITED_LOGIN, tags: ["smoke"] });
    const res = await put("login", EDITED_LOGIN);

    expect(res.status).toBe(200);
    const listed = (await (await harness().request("/api/scenarios")).json()) as {
      scenarios: { id: string; tags: string[] }[];
    };
    expect(listed.scenarios.find((one) => one.id === "login")?.tags).toEqual([]);
  });

  test("reports a scenario that is not on disk as 404 rather than creating it", async () => {
    const res = await put("nope", { ...EDITED_LOGIN, title: "Nope" });

    expect(res.status).toBe(404);
    expect(await Bun.file(join(scenariosDir, "nope.yaml")).exists()).toBe(false);
  });

  test("rejects a body the scenario schema does not accept", async () => {
    const res = await put("login", { title: "No cases", cases: [] });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("at least one case");
    // A rejected edit leaves the committed file exactly as it was.
    expect(await readFile(join(scenariosDir, "login.yaml"), "utf8")).toBe(LOGIN_YAML);
  });

  test("refuses to rename, because the file name is the id", async () => {
    const res = await put("login", { ...EDITED_LOGIN, id: "renamed" });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("id cannot be changed");
    expect(await readFile(join(scenariosDir, "login.yaml"), "utf8")).toBe(LOGIN_YAML);
    expect(await Bun.file(join(scenariosDir, "renamed.yaml")).exists()).toBe(false);
  });

  test("rejects an id that would escape the scenarios directory", async () => {
    const res = await harness().request("/api/scenarios/..%2Fescape", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(EDITED_LOGIN),
    });

    expect(res.status).toBe(400);
    expect(await Bun.file(join(scenariosDir, "../escape.yaml")).exists()).toBe(false);
  });

  test("rejects two cases sharing an id, which would collide in Firestore", async () => {
    const res = await put("login", {
      ...EDITED_LOGIN,
      cases: [
        { id: "same", prompt: "First." },
        { id: "same", prompt: "Second." },
      ],
    });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("duplicate case id");
  });

  test("rejects a non-JSON body", async () => {
    const res = await harness().request("/api/scenarios/login", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: "not json",
    });

    expect(res.status).toBe(400);
  });

  describe("comments in the edited file", () => {
    // Mirrors the shape of the committed scenarios: a header explaining the
    // file, a comment introducing a key, and one per case.
    const COMMENTED_YAML = `# What this scenario covers, in the author's words.
# A second header line, so multi-line prose is covered too.
title: Login
# Cases fall back to the scenario model.
cases:
  # The happy path.
  - id: valid
    prompt: Check that a user can log in.
    maxSteps: 5

  # The failure path.
  - id: invalid
    prompt: Check that a wrong password is rejected.
`;

    async function editCommented(body: (current: Scenario) => unknown): Promise<string> {
      await writeFile(join(scenariosDir, "login.yaml"), COMMENTED_YAML, "utf8");
      const listed = (await (await harness().request("/api/scenarios")).json()) as {
        scenarios: Scenario[];
      };
      const current = listed.scenarios.find((one) => one.id === "login");
      if (current === undefined) {
        throw new Error("fixture did not load");
      }

      const res = await put("login", body(current));
      expect(res.status).toBe(200);
      return await readFile(join(scenariosDir, "login.yaml"), "utf8");
    }

    test("keeps every comment when only the title changes", async () => {
      const written = await editCommented((current) => ({
        ...current,
        title: "Login (revised)",
      }));

      expect(written).toContain("# What this scenario covers, in the author's words.");
      expect(written).toContain("# A second header line, so multi-line prose is covered too.");
      expect(written).toContain("# Cases fall back to the scenario model.");
      expect(written).toContain("# The happy path.");
      expect(written).toContain("# The failure path.");
      expect(written).toContain("title: Login (revised)");
      expect(written).not.toContain("title: Login\n");
    });

    test("keeps the header comment anchored to the top of the file", async () => {
      const written = await editCommented((current) => ({
        ...current,
        title: "Login (revised)",
      }));

      expect(written.startsWith("# What this scenario covers, in the author's words.\n")).toBe(
        true,
      );
    });

    test("keeps the surviving comments when a case is added", async () => {
      const written = await editCommented((current) => ({
        ...current,
        cases: [...current.cases, { id: "locked-out", prompt: "Check the lockout message." }],
      }));

      expect(written).toContain("# The happy path.");
      expect(written).toContain("# The failure path.");
      expect(written).toContain("id: locked-out");
    });

    test("keeps the remaining case's comment when the first case is deleted", async () => {
      const written = await editCommented((current) => ({
        ...current,
        cases: current.cases.filter((one) => one.id !== "valid"),
      }));

      // The deleted case takes its own comment with it; the survivor keeps hers.
      expect(written).toContain("# The failure path.");
      expect(written).not.toContain("# The happy path.");
      expect(written).not.toContain("id: valid");
    });

    test("moves a case's comment with it when the cases are reordered", async () => {
      const written = await editCommented((current) => ({
        ...current,
        cases: [...current.cases].reverse(),
      }));

      const failureAt = written.indexOf("# The failure path.");
      const happyAt = written.indexOf("# The happy path.");
      expect(failureAt).toBeGreaterThanOrEqual(0);
      expect(happyAt).toBeGreaterThan(failureAt);
      // Each comment still sits directly above the case it describes.
      expect(written.indexOf("id: invalid")).toBeGreaterThan(failureAt);
      expect(written.indexOf("id: invalid")).toBeLessThan(happyAt);
    });

    test("leaves an edited file loadable, comments and all", async () => {
      await editCommented((current) => ({ ...current, title: "Login (revised)" }));

      const listed = (await (await harness().request("/api/scenarios")).json()) as {
        scenarios: { id: string; title: string; cases: { id: string }[] }[];
      };
      const reloaded = listed.scenarios.find((one) => one.id === "login");
      expect(reloaded).toMatchObject({ title: "Login (revised)" });
      expect(reloaded?.cases.map((one) => one.id)).toEqual(["valid", "invalid"]);
    });
  });
});

describe("GET /api/models", () => {
  test("returns the models the endpoint offers", async () => {
    const app = createApp({
      store,
      scenariosDir,
      startRun: async () => {},
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
      startRun: async () => {},
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

  test("reports a run that could not be persisted as 500 rather than handing out its id", async () => {
    const res = await failingHarness(0).request("/api/runs", {
      method: "POST",
      body: JSON.stringify({ scenarioId: "login" }),
      headers: { "content-type": "application/json" },
    });

    expect(res.status).toBe(500);
    // No runId in the body: an id nothing will ever serve is worse than none.
    expect((await res.json()) as Record<string, unknown>).not.toHaveProperty("runId");
  });

  test("announces the accepted run, so a window that did not post it sees the row", async () => {
    const bus = new RunEventBus();
    const seen: RunEvent[] = [];
    bus.subscribeAll((event) => seen.push(event));

    const res = await harness(bus).request("/api/runs", {
      method: "POST",
      body: JSON.stringify({ scenarioId: "login" }),
      headers: { "content-type": "application/json" },
    });
    const { runId } = (await res.json()) as { runId: string };

    expect(seen).toEqual([
      { type: "run_queued", runId, scenario: started[0]?.scenario as Scenario },
    ]);
  });

  test("announces nothing for a run that could not be persisted", async () => {
    const bus = new RunEventBus();
    const seen: RunEvent[] = [];
    bus.subscribeAll((event) => seen.push(event));

    const app = createApp({
      store,
      scenariosDir,
      bus,
      startRun: async () => {
        throw new Error("firestore is unavailable");
      },
    });
    await app.request("/api/runs", {
      method: "POST",
      body: JSON.stringify({ scenarioId: "login" }),
      headers: { "content-type": "application/json" },
    });

    // Waking a client to refetch a history the run is not in would leave it
    // showing a list that is missing a run, with nothing to wake it again.
    expect(seen).toEqual([]);
  });
});

describe("POST /api/runs/batch", () => {
  const SHOP_YAML = `title: Shop
cases:
  - id: buys
    prompt: Buy something.
`;

  function batch(body: unknown) {
    return harness().request("/api/runs/batch", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    });
  }

  beforeEach(async () => {
    await writeFile(join(scenariosDir, "shop.yaml"), SHOP_YAML, "utf8");
  });

  test("returns one runId per requested scenario, in the order they were asked for", async () => {
    const res = await batch({ scenarioIds: ["login", "shop"] });

    expect(res.status).toBe(202);
    const body = (await res.json()) as { runIds: string[] };
    expect(body.runIds).toHaveLength(2);
    expect(started.map((one) => one.scenario.id)).toEqual(["login", "shop"]);
    expect(started.map((one) => one.runId)).toEqual(body.runIds);
  });

  test("gives the same scenario asked for twice two separate runs", async () => {
    const res = await batch({ scenarioIds: ["login", "login"] });

    expect(res.status).toBe(202);
    const body = (await res.json()) as { runIds: string[] };
    expect(body.runIds).toHaveLength(2);
    expect(body.runIds[0]).not.toBe(body.runIds[1]);
  });

  test("starts nothing at all when any one of the ids is unknown", async () => {
    const res = await batch({ scenarioIds: ["login", "nope", "shop"] });

    expect(res.status).toBe(404);
    // The whole point of resolving up front: a partial batch would leave the
    // client with no way to learn which of its scenarios actually ran.
    expect(started).toHaveLength(0);
  });

  test("rejects an empty selection rather than answering 202 with no runs", async () => {
    const res = await batch({ scenarioIds: [] });

    expect(res.status).toBe(400);
    expect(started).toHaveLength(0);
  });

  test("rejects scenarioIds that is not an array", async () => {
    const res = await batch({ scenarioIds: "login" });

    expect(res.status).toBe(400);
    expect(started).toHaveLength(0);
  });

  test("rejects an array holding anything that is not a non-empty string", async () => {
    const res = await batch({ scenarioIds: ["login", ""] });

    expect(res.status).toBe(400);
    expect(started).toHaveLength(0);
  });

  test("rejects a body with no scenarioIds at all", async () => {
    const res = await batch({});

    expect(res.status).toBe(400);
  });

  test("rejects a non-JSON body", async () => {
    const res = await harness().request("/api/runs/batch", {
      method: "POST",
      body: "not json",
      headers: { "content-type": "application/json" },
    });

    expect(res.status).toBe(400);
  });

  test("names the runs it already accepted when a later one cannot be persisted", async () => {
    const res = await failingHarness(1).request("/api/runs/batch", {
      method: "POST",
      body: JSON.stringify({ scenarioIds: ["login", "shop"] }),
      headers: { "content-type": "application/json" },
    });

    expect(res.status).toBe(500);
    // Partial rather than rolled back: the first run is queued and will produce
    // a real verdict, so the response says which one that is.
    const body = (await res.json()) as { error: string; runIds: string[] };
    expect(body.runIds).toHaveLength(1);
    expect(started).toHaveLength(1);
    expect(started[0]?.runId).toBe(body.runIds[0]);
  });

  test("announces every accepted run, so the whole queue is visible in every window", async () => {
    const bus = new RunEventBus();
    const seen: RunEvent[] = [];
    bus.subscribeAll((event) => seen.push(event));

    const res = await harness(bus).request("/api/runs/batch", {
      method: "POST",
      body: JSON.stringify({ scenarioIds: ["login", "shop"] }),
      headers: { "content-type": "application/json" },
    });
    const body = (await res.json()) as { runIds: string[] };

    // Without this every window but the one that pressed the button would show
    // only the run that reached a device, and the queue behind it -- the wait
    // the rail exists to make visible -- would never appear anywhere.
    expect(seen.map((event) => event.type)).toEqual(["run_queued", "run_queued"]);
    expect(seen.map((event) => event.runId)).toEqual(body.runIds);
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

  test("replays the recording path so a reloaded page still shows the player", async () => {
    store.add(
      run({
        cases: [caseRun({ videoPath: "/var/videos/run-1/valid.mp4", steps: [step(0)] })],
      }),
    );

    const events = await collectSse(await harness().request("/api/runs/run-1/events"));

    expect(events.find((e) => e.type === "case_finished")).toMatchObject({
      videoPath: "/var/videos/run-1/valid.mp4",
    });
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

  test("does not report a queued run as finished before it has started", async () => {
    // A queued run is neither running nor over. Treating "not running" as
    // "over" would send an immediate synthetic run_finished and the page would
    // render a verdict for a run that never touched a device.
    const bus = new RunEventBus();
    store.add(
      run({ status: "queued", verdictReason: null, finishedAt: null, startedAt: "2026-01-01" }),
    );

    const res = await harness(bus).request("/api/runs/run-1/events");
    void (async () => {
      while (bus.listenerCount("run-1") === 0) {
        await Bun.sleep(1);
      }
      // The one event published, and only so the stream terminates: the
      // subscription is what the queued run was waiting for, and this proves
      // nothing was replayed ahead of it.
      bus.publish({ type: "run_finished", runId: "run-1", status: "passed", reason: "done" });
    })();

    const events = await collectSse(res);
    expect(events.map((e) => e.type)).toEqual(["run_finished"]);
    expect(events[0]).toMatchObject({ reason: "done" });
  });

  test("delivers a terminal event published while the history was still replaying", async () => {
    // The race this guards: the replay awaits a write per case and per step,
    // and a short run can finish inside one of those awaits. Subscribing only
    // after the replay would publish run_finished to nobody and then close the
    // stream silently, and the page -- which does not refetch when the stream
    // ends -- would stay on the status its first fetch saw, forever.
    //
    // Publishing before the response is even read is the strongest form of the
    // race: it can only be observed if the subscription was registered before
    // the first replay write, which is exactly the fix.
    const bus = new RunEventBus();
    store.add(
      run({
        status: "running",
        verdictReason: null,
        finishedAt: null,
        cases: [
          caseRun({ status: "running", finishedAt: null, verdictReason: null, steps: [step(0)] }),
        ],
      }),
    );

    const res = await harness(bus).request("/api/runs/run-1/events");
    bus.publish({ type: "run_finished", runId: "run-1", status: "passed", reason: "done" });

    const events = await collectSse(res);
    // The history still arrives first: an event that lands during the replay is
    // held back rather than interleaved, so the client reads one timeline.
    expect(events.map((e) => e.type)).toEqual(["case_started", "step_recorded", "run_finished"]);
    expect(events.at(-1)).toMatchObject({ status: "passed", reason: "done" });
  });

  test("still ends the stream with a verdict when the run finished before anyone subscribed", async () => {
    // The other half of the same race: the run finished so early that even a
    // subscription registered first has nothing to receive, and the bus only
    // remembers that it happened. Closing on `hasFinished` without saying what
    // the verdict was leaves the page pinned at "running" with no way out.
    const bus = new RunEventBus();
    bus.publish({ type: "run_finished", runId: "run-1", status: "failed", reason: "no greeting" });
    // The store is the authority on the verdict; the stale `running` document
    // is what a client racing the finishRun write would have fetched.
    store.add(
      run({ status: "failed", verdictReason: "no greeting", finishedAt: "2026-01-01T00:01:00Z" }),
    );

    const events = await collectSse(await harness(bus).request("/api/runs/run-1/events"));

    expect(events.map((e) => e.type)).toEqual(["run_finished"]);
    expect(events[0]).toMatchObject({ status: "failed", reason: "no greeting" });
  });

  test("does not send two terminal events when the bus both remembers and replays the finish", async () => {
    // `hasFinished` stays true for the rest of the process, so a stream that
    // received a real run_finished must not then synthesise a second one: the
    // client closes on the first, and the second would be a write into a
    // stream that is already gone.
    const bus = new RunEventBus();
    store.add(run({ status: "running", verdictReason: null, finishedAt: null }));

    const res = await harness(bus).request("/api/runs/run-1/events");
    bus.publish({ type: "run_finished", runId: "run-1", status: "passed", reason: "done" });

    const events = await collectSse(res);
    expect(events.filter((e) => e.type === "run_finished")).toHaveLength(1);
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
      {
        type: "case_finished",
        runId: "run-1",
        caseId: "valid",
        status: "passed",
        reason: "done",
        videoPath: null,
      },
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

describe("GET /api/events", () => {
  /** Waits for the handler to attach, since it subscribes as the body is read. */
  async function untilSubscribed(bus: RunEventBus): Promise<void> {
    while (bus.globalListenerCount() === 0) {
      await Bun.sleep(1);
    }
  }

  /** Reads SSE frames until `count` have arrived, then lets the caller stop. */
  async function readSse(res: Response, count: number): Promise<{ type: string }[]> {
    const body = res.body;
    if (body === null) {
      throw new Error("expected a streaming body");
    }
    const reader = body.getReader();
    const decoder = new TextDecoder();
    const seen: { type: string }[] = [];
    let buffered = "";

    // Read incrementally rather than res.text(): this stream has no terminal
    // event, so waiting for it to close would hang.
    while (seen.length < count) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffered += decoder.decode(value, { stream: true });
      for (const line of buffered.split("\n")) {
        const isData = line.startsWith("data: ");
        if (isData) {
          seen.push(JSON.parse(line.slice("data: ".length)) as { type: string });
        }
      }
      buffered = "";
    }

    await reader.cancel();
    return seen;
  }

  test("streams run_finished for a run nobody is watching individually", async () => {
    const bus = new RunEventBus();

    const res = await harness(bus).request("/api/events");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    // The handler subscribes while the body is being consumed, so an event
    // published before that lands would be delivered to nobody.
    await untilSubscribed(bus);
    bus.publish({ type: "run_finished", runId: "run-1", status: "passed", reason: "done" });

    const events = await readSse(res, 1);
    expect(events.map((e) => e.type)).toEqual(["run_finished"]);
  });

  test("ignores per-step events so a client is only woken by run boundaries", async () => {
    const bus = new RunEventBus();

    const res = await harness(bus).request("/api/events");
    await untilSubscribed(bus);
    bus.publish({ type: "step_started", runId: "run-1", caseId: "valid", index: 0 });
    bus.publish({ type: "run_finished", runId: "run-1", status: "passed", reason: "done" });

    const events = await readSse(res, 1);
    expect(events.map((e) => e.type)).toEqual(["run_finished"]);
  });

  test("streams run_queued, so a tab that did not start the run still sees it appear", async () => {
    const bus = new RunEventBus();

    const res = await harness(bus).request("/api/events");
    await untilSubscribed(bus);
    bus.publish({ type: "run_queued", runId: "run-1", scenario: SCENARIO });

    const events = await readSse(res, 1);
    expect(events.map((e) => e.type)).toEqual(["run_queued"]);
  });
});

/**
 * Which events wake a history view. The consequence of getting this wrong is
 * asymmetric: forward too little and a run is invisible in every window but the
 * one that started it, forward too much and every client refetches the whole
 * history several times a second for a change none of them render.
 */
describe("movesTheHistory", () => {
  test("wakes clients when a run is accepted, which is when its row starts existing", () => {
    expect(movesTheHistory({ type: "run_queued", runId: "run-1", scenario: SCENARIO })).toBe(true);
  });

  test("wakes clients when a run reaches a device, which is when its status changes", () => {
    expect(movesTheHistory({ type: "run_started", runId: "run-1", scenario: SCENARIO })).toBe(true);
  });

  test("wakes clients when a run reaches a verdict", () => {
    expect(
      movesTheHistory({ type: "run_finished", runId: "run-1", status: "passed", reason: null }),
    ).toBe(true);
  });

  test("stays quiet for the per-step events only an open run page renders", () => {
    const perStep: RunEvent[] = [
      { type: "step_started", runId: "run-1", caseId: "valid", index: 0 },
      { type: "ui_captured", runId: "run-1", caseId: "valid", index: 0, uiText: "[0] Button" },
      { type: "action_executed", runId: "run-1", caseId: "valid", index: 0, action: TAP },
    ];

    for (const event of perStep) {
      expect(movesTheHistory(event)).toBe(false);
    }
  });

  test("stays quiet for case boundaries, which change no row of the run list", () => {
    expect(
      movesTheHistory({
        type: "case_finished",
        runId: "run-1",
        caseId: "valid",
        status: "passed",
        reason: null,
        videoPath: null,
      }),
    ).toBe(false);
  });
});

describe("GET /videos/*", () => {
  test("serves a run's recording from the videos directory", async () => {
    const videosDir = await mkdtemp(join(tmpdir(), "gemma-videos-"));
    await mkdir(join(videosDir, "run-1"), { recursive: true });
    await writeFile(join(videosDir, "run-1", "valid.mp4"), "not really an mp4");

    const app = createApp({ store, scenariosDir, startRun: async () => {}, videosDir });
    const res = await app.request("/videos/run-1/valid.mp4");

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("not really an mp4");

    await rm(videosDir, { recursive: true, force: true });
  });

  test("is absent when no videos directory is configured", async () => {
    const res = await harness().request("/videos/run-1/valid.mp4");

    expect(res.status).toBe(404);
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
      startRun: async () => {},
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
      startRun: async () => {},
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
      startRun: async () => {},
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
      startRun: async () => {},
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
    const app = createApp({ store, scenariosDir, startRun: async () => {}, logger: log.logger });

    const res = await app.request("/api/runs/run-1/events");
    await res.text();

    expect(log.events().find((e) => e.event === "sse.connected")).toMatchObject({
      runId: "run-1",
      status: "passed",
    });
  });

  test("writes nothing when no logger is injected", async () => {
    const app = createApp({ store: new FakeStore(), scenariosDir, startRun: async () => {} });

    const res = await app.request("/api/scenarios");

    expect(res.status).toBe(200);
  });
});

/**
 * Both sources are attached at once and the request picks, so a run on either
 * platform can be watched without restarting the server. These pin the
 * selection; the sources themselves are covered by their own suites.
 */
describe("GET /api/device", () => {
  const source = (label: string): DeviceSource => ({
    getStatus: async () => ({
      uptimeMs: null,
      booted: true,
      hardwareConfig: { which: label },
    }),
    openFrameStream: () => ({
      on: () => {},
      cancel: () => {},
    }),
  });

  function withDevices(devices: {
    android?: DeviceSource | undefined;
    web?: DeviceSource | undefined;
  }) {
    return createApp({ store, scenariosDir, startRun: async () => {}, devices });
  }

  /** `res.json()` is `unknown`, and the label is the only field these read. */
  async function whichSource(res: Response): Promise<string | undefined> {
    const body = (await res.json()) as { device?: { hardwareConfig?: Record<string, string> } };
    return body.device?.hardwareConfig?.["which"];
  }

  test("lists the platforms it can show", async () => {
    const res = await withDevices({ android: source("a"), web: source("w") }).request(
      "/api/device/platforms",
    );

    expect(await res.json()).toEqual({ platforms: ["android", "web"] });
  });

  test("lists only what is attached, so a picker can hide itself", async () => {
    const res = await withDevices({ web: source("w") }).request("/api/device/platforms");

    expect(await res.json()).toEqual({ platforms: ["web"] });
  });

  test("answers from the platform the request names", async () => {
    const app = withDevices({ android: source("emulator"), web: source("browser") });

    const android = await app.request("/api/device/status?platform=android");
    const web = await app.request("/api/device/status?platform=web");

    expect(await whichSource(android)).toBe("emulator");
    expect(await whichSource(web)).toBe("browser");
  });

  test("falls back to the only source when the request names none", async () => {
    // A single-platform setup keeps working without a query string.
    const res = await withDevices({ web: source("browser") }).request("/api/device/status");

    expect(await whichSource(res)).toBe("browser");
  });

  test("reports a platform that is not attached, rather than showing the other", async () => {
    const res = await withDevices({ android: source("emulator") }).request(
      "/api/device/status?platform=web",
    );

    expect(res.status).toBe(404);
  });

  test("reports a source that cannot answer as unavailable, not as a crash", async () => {
    // Which the Device page renders as guidance -- "start the emulator".
    const app = createApp({
      store,
      scenariosDir,
      startRun: async () => {},
      devices: {
        android: {
          getStatus: async () => {
            throw new Error("connect ECONNREFUSED");
          },
          openFrameStream: () => ({ on: () => {}, cancel: () => {} }),
        },
      },
    });

    const res = await app.request("/api/device/status?platform=android");

    expect(res.status).toBe(503);
  });

  test("serves no device routes at all when neither source is attached", async () => {
    const res = await withDevices({}).request("/api/device/platforms");

    expect(res.status).toBe(404);
  });
});
