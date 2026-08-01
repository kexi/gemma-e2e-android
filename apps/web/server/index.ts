import { join } from "node:path";
import { AdbClient } from "@gemma-e2e/adb";
import {
  createGenkitLlmFactory,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  runScenario,
} from "@gemma-e2e/agent";
import { createLogger, errorFields, parseLogLevel } from "@gemma-e2e/logger";
import { Store } from "@gemma-e2e/store";
import { createApp, type StartRunInput, websocket } from "./app.ts";
import { DEFAULT_EMULATOR_GRPC_TARGET, EmulatorClient } from "./device-stream.ts";
import { listModels } from "./models.ts";

const DEFAULT_PORT = 5175;

const repoRoot = join(import.meta.dir, "..", "..", "..");
const port = Number(process.env["PORT"] ?? DEFAULT_PORT);
const scenariosDir = process.env["SCENARIOS_DIR"] ?? join(repoRoot, "scenarios");
const varDir = process.env["VAR_DIR"] ?? join(repoRoot, "var");
const screenshotsDir = join(varDir, "screenshots");
const clientDir = join(import.meta.dir, "..", "dist");
const llmBaseURL = process.env["LLM_BASE_URL"] ?? DEFAULT_BASE_URL;
// Last resort in the case → scenario → env chain; a scenario that names no
// model anywhere still has to run on something.
const defaultModel = process.env["LLM_MODEL"] ?? DEFAULT_MODEL;

// The one place a logger is actually wired to stderr: every package defaults to
// a no-op, so the process entrypoint decides that this run writes NDJSON.
const logger = createLogger({
  level: parseLogLevel(process.env["LOG_LEVEL"]),
  bindings: { service: "web" },
});

const store = Store.open();

// Constructed once and shared: both hold only configuration, and a device or
// model that is missing surfaces as a run with status=error rather than as a
// startup crash, so the dashboard stays usable without hardware attached.
const adb = new AdbClient({ serial: process.env["ANDROID_SERIAL"], logger });
// A factory rather than a client: the model is chosen per case, and one Genkit
// instance underneath serves every model a run touches.
const llm = createGenkitLlmFactory({ baseURL: llmBaseURL, logger });

function startRun({ runId, scenario, onEvent }: StartRunInput): void {
  // Deliberately not awaited: POST /api/runs answers 202 immediately and the
  // client follows progress over SSE. runScenario already converts every
  // failure into a finished case with status=error, so a rejection here would
  // only mean the store itself is broken.
  void runScenario(scenario, {
    adb,
    llm,
    store,
    screenshotDir: screenshotsDir,
    defaultModel,
    runId,
    onEvent,
    logger,
  }).catch((error: unknown) => {
    logger.error("run.crashed", { runId, ...errorFields(error) });
  });
}

const isProduction = await Bun.file(join(clientDir, "index.html")).exists();

// Constructed unconditionally: grpc-js connects lazily, so an emulator that is
// absent (or started without -grpc) costs nothing here and instead surfaces as
// a 503 on /api/device/status, which the Device page renders as guidance.
const emulatorGrpcTarget = process.env["EMULATOR_GRPC"] ?? DEFAULT_EMULATOR_GRPC_TARGET;
const device = new EmulatorClient(emulatorGrpcTarget, { logger });

const app = createApp({
  store,
  scenariosDir,
  startRun,
  screenshotsDir,
  logger,
  device,
  listModels: () => listModels({ baseURL: llmBaseURL, logger }),
  ...(isProduction ? { clientDir } : {}),
});

logger.info("server.started", {
  port,
  scenariosDir,
  varDir,
  emulatorGrpcTarget,
  defaultModel,
  firestoreEmulator: process.env["FIRESTORE_EMULATOR_HOST"] ?? null,
  mode: isProduction ? "prod" : "dev",
});

export default { port, fetch: app.fetch, websocket };
