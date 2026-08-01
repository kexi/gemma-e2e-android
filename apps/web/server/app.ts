import { join } from "node:path";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { serveStatic, upgradeWebSocket, websocket } from "hono/bun";
import { Document as YamlDocument, isScalar, Scalar, visit } from "yaml";
import { loadScenariosDir, type Run, type Scenario, ScenarioSchema } from "@gemma-e2e/core";
import { errorFields, type Logger, noopLogger } from "@gemma-e2e/logger";
import type { RunEvent } from "@gemma-e2e/agent";
import { RunEventBus } from "./bus.ts";
import {
  type DeviceStatus,
  type FrameSink,
  type FrameStream,
  relayFrames,
} from "./device-stream.ts";
import type { ModelInfo } from "./models.ts";

/** The slice of Store the dashboard reads; tests inject an in-memory double. */
export interface StoreReader {
  listRuns(limit?: number): Promise<Run[]>;
  getRun(id: string): Promise<Run | null>;
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

/**
 * The emulator-facing half of the Device page. Optional so the dashboard still
 * boots with no emulator attached, and so tests can leave it out entirely.
 */
export interface DeviceSource {
  getStatus(): Promise<DeviceStatus>;
  openFrameStream(): FrameStream;
}

export interface AppDeps {
  store: StoreReader;
  scenariosDir: string;
  startRun: StartRun;
  screenshotsDir?: string | undefined;
  /** Backs `/videos/*`; omitted, finished cases show no player. */
  videosDir?: string | undefined;
  clientDir?: string | undefined;
  bus?: RunEventBus | undefined;
  /** Defaults to a no-op so the app tests stay quiet unless they opt in. */
  logger?: Logger | undefined;
  device?: DeviceSource | undefined;
  /** Backs GET /api/models; omitted, the endpoint reports 503. */
  listModels?: (() => Promise<ModelInfo[]>) | undefined;
}

interface CreateRunBody {
  scenarioId?: unknown;
  prompt?: unknown;
  title?: unknown;
  model?: unknown;
}

const AD_HOC_SCENARIO_ID = "ad-hoc";
const AD_HOC_CASE_ID = "ad-hoc";
const AD_HOC_MAX_STEPS = 20;
/** A scenario id is also a filename, so it may not carry a path separator. */
const SCENARIO_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

// Bun needs the websocket handler at serve() time, so the entrypoint gets it
// from here alongside the app. Imported directly from hono/bun rather than
// built with createBunWebSocket(), which is deprecated in favour of this.
export { websocket };

export function createApp(deps: AppDeps) {
  const bus = deps.bus ?? new RunEventBus();
  const log = deps.logger ?? noopLogger;
  const app = new Hono();

  // One line per completed request, emitted after the handler so the status and
  // duration are known. Static asset routes are included: a 404 on a built
  // asset is exactly the kind of deploy mistake this is meant to surface.
  app.use("*", async (c, next) => {
    const startedAt = performance.now();
    await next();
    log.info("http.request", {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Math.round(performance.now() - startedAt),
    });
  });

  app.get("/api/scenarios", async (c) => {
    try {
      const scenarios = await loadScenariosDir(deps.scenariosDir);
      return c.json({ scenarios });
    } catch (error) {
      log.error("http.scenarios_failed", {
        scenariosDir: deps.scenariosDir,
        ...errorFields(error),
      });
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }
  });

  // The dashboard's scenario builder writes a file the same way a contributor
  // would: the UI is an entry point to `scenarios/`, not a second store.
  app.post("/api/scenarios", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "body must be JSON" }, 400);
    }

    const parsed = ScenarioSchema.safeParse(body);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
        .join("; ");
      return c.json({ error: `not a valid scenario (${issues})` }, 400);
    }

    const scenario = parsed.data;
    // The id becomes a filename, so it is held to the same slug rule as a case
    // id rather than the schema's looser "non-empty string".
    const isSlug = SCENARIO_ID_PATTERN.test(scenario.id);
    if (!isSlug) {
      return c.json({ error: "id must be a lowercase slug (a-z, 0-9, hyphen)" }, 400);
    }

    const duplicate = findDuplicateCaseId(scenario);
    if (duplicate !== null) {
      return c.json({ error: `duplicate case id "${duplicate}"` }, 400);
    }

    const path = join(deps.scenariosDir, `${scenario.id}.yaml`);
    // Refused rather than merged or overwritten: these files are git-managed,
    // and a builder that silently replaces one would destroy reviewed work.
    const exists = await Bun.file(path).exists();
    if (exists) {
      return c.json({ error: `scenario "${scenario.id}" already exists` }, 409);
    }

    try {
      await Bun.write(path, toScenarioYaml(scenario));
    } catch (error) {
      log.error("http.scenario_write_failed", { path, ...errorFields(error) });
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }

    log.info("scenario.created", { scenarioId: scenario.id, cases: scenario.cases.length, path });
    return c.json({ scenario, path }, 201);
  });

  const listModels = deps.listModels;
  app.get("/api/models", async (c) => {
    const hasSource = listModels !== undefined;
    if (!hasSource) {
      return c.json({ error: "no model endpoint configured" }, 503);
    }

    try {
      return c.json({ models: await listModels() });
    } catch (error) {
      // 503 rather than 500: a model server that is not running is an expected
      // state the dashboard renders as guidance, not a fault in this server.
      log.warn("models.unavailable", errorFields(error));
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 503);
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
    log.info("run.requested", {
      runId,
      scenarioId: scenario.value.id,
      cases: scenario.value.cases.length,
    });
    deps.startRun({
      runId,
      scenario: scenario.value,
      onEvent: (event) => bus.publish(event),
    });

    return c.json({ runId }, 202);
  });

  app.get("/api/runs", async (c) => {
    return c.json({ runs: await deps.store.listRuns() });
  });

  app.get("/api/runs/:id", async (c) => {
    const run = await deps.store.getRun(c.req.param("id"));
    if (run === null) {
      return c.json({ error: "no such run" }, 404);
    }
    return c.json({ run });
  });

  app.get("/api/runs/:id/events", async (c) => {
    const runId = c.req.param("id");
    const run = await deps.store.getRun(runId);
    if (run === null) {
      return c.json({ error: "no such run" }, 404);
    }

    const replayedSteps = run.cases.reduce((total, one) => total + one.steps.length, 0);
    const sseLog = log.child({ runId });
    sseLog.info("sse.connected", { replayedSteps, cases: run.cases.length, status: run.status });

    return streamSSE(c, async (stream) => {
      // Replay before subscribing so a client that attaches mid-run (or after
      // it ended) sees the same timeline as one that was there from the start.
      // Events published during the replay are picked up by the subscription
      // below; a duplicate step is harmless because the client keys by
      // (caseId, index).
      for (const caseRun of run.cases) {
        await stream.writeSSE({
          event: "case_started",
          data: JSON.stringify({
            type: "case_started",
            runId,
            caseId: caseRun.caseId,
            caseRun: { ...caseRun, steps: [] },
          }),
        });

        for (const step of caseRun.steps) {
          await stream.writeSSE({
            event: "step_recorded",
            data: JSON.stringify({ type: "step_recorded", runId, caseId: caseRun.caseId, step }),
          });
        }

        const caseIsOver = caseRun.status !== "running";
        if (caseIsOver) {
          await stream.writeSSE({
            event: "case_finished",
            data: JSON.stringify({
              type: "case_finished",
              runId,
              caseId: caseRun.caseId,
              status: caseRun.status,
              reason: caseRun.verdictReason,
              videoPath: caseRun.videoPath,
            }),
          });
        }
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
          sseLog.info("sse.aborted", {});
          resolve();
        });
      });

      sseLog.info("sse.disconnected", {});
    });
  });

  const device = deps.device;
  const hasDevice = device !== undefined;
  if (hasDevice) {
    app.get("/api/device/status", async (c) => {
      try {
        return c.json({ device: await device.getStatus() });
      } catch (error) {
        // An emulator that is down is an expected state for this page, not a
        // server fault: 503 lets the client say "start the emulator" rather
        // than render a crash.
        log.warn("device.status_unavailable", errorFields(error));
        const message = error instanceof Error ? error.message : String(error);
        return c.json({ error: message }, 503);
      }
    });

    app.get(
      "/api/device/stream",
      upgradeWebSocket(() => {
        let stop: (() => void) | null = null;
        return {
          onOpen(_event, ws) {
            const sink: FrameSink = {
              send: (data) => {
                ws.send(data);
              },
              close: (code, reason) => {
                ws.close(code, reason);
              },
            };
            // Throttled to ~20 fps: streamScreenshot only emits on change, so
            // this caps a busy animation without adding latency to an idle
            // screen, where frames are already rare.
            stop = relayFrames(() => device.openFrameStream(), sink, {
              minFrameIntervalMs: 50,
              logger: log,
            });
          },
          onClose() {
            stop?.();
            stop = null;
          },
          onError(event) {
            log.warn("device.socket_failed", { event: String(event) });
            stop?.();
            stop = null;
          },
        };
      }),
    );
  }

  const hasScreenshots = deps.screenshotsDir !== undefined;
  if (hasScreenshots) {
    app.get(
      "/screenshots/*",
      serveStatic({ root: deps.screenshotsDir as string, rewriteRequestPath: stripPrefix }),
    );
  }

  const hasVideos = deps.videosDir !== undefined;
  if (hasVideos) {
    app.get(
      "/videos/*",
      serveStatic({ root: deps.videosDir as string, rewriteRequestPath: stripVideosPrefix }),
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

/**
 * Serialises a scenario the way the committed files are written: the `id` is
 * dropped because the loader takes it from the filename, and every `prompt` is
 * forced to a folded block scalar so prose wraps at the margin.
 */
function toScenarioYaml(scenario: Scenario): string {
  const { id: _id, ...rest } = scenario;
  const doc = new YamlDocument(rest);

  // Only prompts are folded, not every string: a global block-scalar default
  // would turn `id: login` into a three-line scalar as well.
  visit(doc, {
    Pair(_index, pair) {
      const key = pair.key;
      const isPrompt = isScalar(key) && key.value === "prompt";
      if (!isPrompt) {
        return;
      }
      const value = pair.value;
      const isText = isScalar(value) && typeof value.value === "string";
      if (isText) {
        value.type = Scalar.BLOCK_FOLDED;
      }
    },
  });

  return doc.toString({ lineWidth: 80 });
}

function findDuplicateCaseId(scenario: Scenario): string | null {
  const seen = new Set<string>();
  for (const testCase of scenario.cases) {
    const isDuplicate = seen.has(testCase.id);
    if (isDuplicate) {
      return testCase.id;
    }
    seen.add(testCase.id);
  }
  return null;
}

function stripPrefix(path: string): string {
  return path.replace(/^\/screenshots/, "");
}

function stripVideosPrefix(path: string): string {
  return path.replace(/^\/videos/, "");
}

type ScenarioResolution = { value: Scenario } | { error: string; status: 400 | 404 };

async function resolveScenario(
  body: CreateRunBody,
  scenariosDir: string,
): Promise<ScenarioResolution> {
  const isAdHoc = isNonEmptyString(body.prompt);
  if (isAdHoc) {
    const title = isNonEmptyString(body.title) ? body.title : "Ad-hoc run";
    // A one-off prompt is a scenario of exactly one case: the runner has a
    // single shape to execute, and the run's history looks the same whether it
    // came from a file or the dashboard's form.
    return {
      value: {
        id: AD_HOC_SCENARIO_ID,
        title,
        cases: [
          {
            id: AD_HOC_CASE_ID,
            title,
            prompt: body.prompt as string,
            maxSteps: AD_HOC_MAX_STEPS,
            ...(isNonEmptyString(body.model) ? { model: body.model } : {}),
          },
        ],
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
