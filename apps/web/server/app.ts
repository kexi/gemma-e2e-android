import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { serveStatic } from "hono/bun";
import { loadScenariosDir, type Run, type Scenario } from "@gemma-e2e/core";
import type { RunEvent } from "@gemma-e2e/agent";
import { RunEventBus } from "./bus.ts";

/** The slice of Store the dashboard reads; tests inject an in-memory double. */
export interface StoreReader {
  listRuns(limit?: number): Run[];
  getRun(id: string): Run | null;
}

export interface StartRunInput {
  runId: string;
  scenario: Scenario;
  onEvent: (event: RunEvent) => void;
}

/**
 * Kicks off a run and resolves as soon as it is scheduled, not when it ends.
 * The dashboard answers 202 and then follows the run over SSE.
 */
export type StartRun = (input: StartRunInput) => void;

export interface AppDeps {
  store: StoreReader;
  scenariosDir: string;
  startRun: StartRun;
  screenshotsDir?: string | undefined;
  clientDir?: string | undefined;
  bus?: RunEventBus | undefined;
}

interface CreateRunBody {
  scenarioId?: unknown;
  prompt?: unknown;
  title?: unknown;
}

const AD_HOC_SCENARIO_ID = "ad-hoc";
const AD_HOC_MAX_STEPS = 20;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

export function createApp(deps: AppDeps) {
  const bus = deps.bus ?? new RunEventBus();
  const app = new Hono();

  app.get("/api/scenarios", async (c) => {
    try {
      const scenarios = await loadScenariosDir(deps.scenariosDir);
      return c.json({ scenarios });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }
  });

  app.post("/api/runs", async (c) => {
    let body: CreateRunBody;
    try {
      body = (await c.req.json()) as CreateRunBody;
    } catch {
      return c.json({ error: "body must be JSON" }, 400);
    }

    const scenario = await resolveScenario(body, deps.scenariosDir);
    if ("error" in scenario) {
      return c.json({ error: scenario.error }, scenario.status);
    }

    const runId = crypto.randomUUID();
    deps.startRun({
      runId,
      scenario: scenario.value,
      onEvent: (event) => bus.publish(event),
    });

    return c.json({ runId }, 202);
  });

  app.get("/api/runs", (c) => {
    return c.json({ runs: deps.store.listRuns() });
  });

  app.get("/api/runs/:id", (c) => {
    const run = deps.store.getRun(c.req.param("id"));
    if (run === null) {
      return c.json({ error: "no such run" }, 404);
    }
    return c.json({ run });
  });

  app.get("/api/runs/:id/events", (c) => {
    const runId = c.req.param("id");
    const run = deps.store.getRun(runId);
    if (run === null) {
      return c.json({ error: "no such run" }, 404);
    }

    return streamSSE(c, async (stream) => {
      // Replay before subscribing so a client that attaches mid-run (or after
      // it ended) sees the same timeline as one that was there from the start.
      // Events published during the replay are picked up by the subscription
      // below; a duplicate step is harmless because the client keys by index.
      for (const step of run.steps) {
        await stream.writeSSE({
          event: "step_recorded",
          data: JSON.stringify({ type: "step_recorded", runId, step }),
        });
      }

      const isOver = run.status !== "running";
      if (isOver) {
        await stream.writeSSE({
          event: "run_finished",
          data: JSON.stringify({
            type: "run_finished",
            runId,
            status: run.status,
            reason: run.verdictReason,
          }),
        });
        return;
      }

      const alreadyFinished = bus.hasFinished(runId);
      if (alreadyFinished) {
        return;
      }

      // Writes are chained rather than fired and forgotten: the bus is
      // synchronous, so two events arriving back to back would otherwise
      // interleave their writes, and the final one could still be in flight
      // when the terminal event closes the stream.
      let pending: Promise<void> = Promise.resolve();

      await new Promise<void>((resolve) => {
        const unsubscribe = bus.subscribe(runId, (event) => {
          pending = pending.then(() =>
            stream.writeSSE({ event: event.type, data: JSON.stringify(event) }),
          );

          const isTerminal = event.type === "run_finished";
          if (isTerminal) {
            unsubscribe();
            pending.then(resolve, resolve);
          }
        });

        stream.onAbort(() => {
          unsubscribe();
          resolve();
        });
      });
    });
  });

  const hasScreenshots = deps.screenshotsDir !== undefined;
  if (hasScreenshots) {
    app.get(
      "/screenshots/*",
      serveStatic({ root: deps.screenshotsDir as string, rewriteRequestPath: stripPrefix }),
    );
  }

  const hasClient = deps.clientDir !== undefined;
  if (hasClient) {
    const root = deps.clientDir as string;
    app.get("/assets/*", serveStatic({ root }));
    // Client-side routing: any non-API path that is not a built asset has to
    // reach the SPA shell, or a hard refresh on /runs/:id would 404.
    app.get("*", serveStatic({ root, path: "index.html" }));
  }

  return app;
}

function stripPrefix(path: string): string {
  return path.replace(/^\/screenshots/, "");
}

type ScenarioResolution = { value: Scenario } | { error: string; status: 400 | 404 };

async function resolveScenario(
  body: CreateRunBody,
  scenariosDir: string,
): Promise<ScenarioResolution> {
  const isAdHoc = isNonEmptyString(body.prompt);
  if (isAdHoc) {
    const prompt = body.prompt as string;
    return {
      value: {
        id: AD_HOC_SCENARIO_ID,
        title: isNonEmptyString(body.title) ? body.title : "Ad-hoc run",
        prompt,
        maxSteps: AD_HOC_MAX_STEPS,
      },
    };
  }

  const hasScenarioId = isNonEmptyString(body.scenarioId);
  if (!hasScenarioId) {
    return { error: "body must contain either scenarioId or prompt", status: 400 };
  }

  let scenarios: Scenario[];
  try {
    scenarios = await loadScenariosDir(scenariosDir);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: message, status: 400 };
  }

  const found = scenarios.find((s) => s.id === body.scenarioId);
  if (found === undefined) {
    return { error: `no such scenario: ${String(body.scenarioId)}`, status: 404 };
  }
  return { value: found };
}
