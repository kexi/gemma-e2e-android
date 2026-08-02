import { join } from "node:path";
import { AdbClient } from "@gemma-e2e/adb";
import { CdpClient, type CdpSession, DEFAULT_DEBUGGING_PORT, endpointOf } from "@gemma-e2e/cdp";
import {
  CdpRecorder,
  createDriverResolver,
  createGenkitLlmFactory,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  runScenario,
  ScrcpyRecorder,
} from "@gemma-e2e/agent";
import { createLogger, errorFields, parseLogLevel } from "@gemma-e2e/logger";
import { Store } from "@gemma-e2e/store";
import { createApp, type StartRunInput, websocket } from "./app.ts";
import { CdpDeviceSource } from "./cdp-device.ts";
import { DEFAULT_EMULATOR_GRPC_TARGET, EmulatorClient } from "./device-stream.ts";
import { listModels } from "./models.ts";

const DEFAULT_PORT = 5175;

const repoRoot = join(import.meta.dir, "..", "..", "..");
const port = Number(process.env["PORT"] ?? DEFAULT_PORT);
const scenariosDir = process.env["SCENARIOS_DIR"] ?? join(repoRoot, "scenarios");
const varDir = process.env["VAR_DIR"] ?? join(repoRoot, "var");
const screenshotsDir = join(varDir, "screenshots");
const videosDir = join(varDir, "videos");
const clientDir = join(import.meta.dir, "..", "dist");
const llmBaseURL = process.env["LLM_BASE_URL"] ?? DEFAULT_BASE_URL;
const chromePort = Number(process.env["CHROME_PORT"] ?? DEFAULT_DEBUGGING_PORT);
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

// On unless explicitly switched off: a recording is the artifact that explains
// a failure nobody watched live, so the useful default is to always have one.
const isRecording = process.env["RECORD_RUNS"] !== "0";
// The same serial adb targets, so both halves follow one device when several
// are attached.
const recorder = isRecording
  ? new ScrcpyRecorder({ videoDir: videosDir, serial: process.env["ANDROID_SERIAL"], logger })
  : undefined;
// A factory rather than a client: the model is chosen per case, and one Genkit
// instance underneath serves every model a run touches.
const llm = createGenkitLlmFactory({ baseURL: llmBaseURL, logger });

// Constructed unconditionally and connected lazily, like `adb` above: a
// machine with no Chrome running still boots the dashboard, and a web case
// then fails with a message naming the flag to start it with.
const cdp = new CdpClient({
  endpoint: process.env["CHROME_ENDPOINT"] ?? endpointOf(chromePort),
  logger,
});

// Stated here rather than left to the client's default because the recorder
// needs the same numbers: a container declaring one size while the frames are
// another produces a video that plays stretched or not at all. A scenario's
// own `viewport` overrides the page but not this, so a case that resizes gets
// a letterboxed recording rather than a broken one.
const CHROME_VIEWPORT = { width: 1280, height: 900 } as const;

// Built per session rather than shared like scrcpy's: a screencast belongs to
// one page, so each case's recorder is bound to the page that case opened.
const webRecorder = isRecording
  ? (session: CdpSession) =>
      new CdpRecorder({
        videoDir: videosDir,
        subscribe: (handler) => cdp.onFrames(session, handler),
        ...CHROME_VIEWPORT,
        logger,
      })
  : undefined;

// Resolved per case rather than fixed here, so one scenario may name a
// different platform on each of its cases. The platform halves above are
// long-lived and shared; only the per-case driver is new each time.
const openDriver = createDriverResolver({
  android: { adb, ...(recorder === undefined ? {} : { recorder }) },
  web: { cdp, ...(webRecorder === undefined ? {} : { recorder: webRecorder }) },
});

function startRun({ runId, scenario, onEvent }: StartRunInput): void {
  // Deliberately not awaited: POST /api/runs answers 202 immediately and the
  // client follows progress over SSE. runScenario already converts every
  // failure into a finished case with status=error, so a rejection here would
  // only mean the store itself is broken.
  void runScenario(scenario, {
    openDriver,
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
// a 503 on /api/device/status, which the Device page renders as guidance. The
// CDP source behaves the same way, for the same reason.
const emulatorGrpcTarget = process.env["EMULATOR_GRPC"] ?? DEFAULT_EMULATOR_GRPC_TARGET;

// One live view, so which platform it watches is a choice rather than
// something derived: a run may name either, and the page cannot show both at
// once. Android stays the default because it is what the view was built for.
const livePlatform = process.env["LIVE_VIEW"] === "web" ? "web" : "android";
const device =
  livePlatform === "web"
    ? new CdpDeviceSource(cdp, {
        ...(process.env["LIVE_VIEW_URL"] === undefined
          ? {}
          : { url: process.env["LIVE_VIEW_URL"] }),
        viewport: CHROME_VIEWPORT,
        logger,
      })
    : new EmulatorClient(emulatorGrpcTarget, { logger });

const app = createApp({
  store,
  scenariosDir,
  startRun,
  screenshotsDir,
  videosDir,
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
  chromePort,
  livePlatform,
  defaultModel,
  recording: isRecording,
  firestoreEmulator: process.env["FIRESTORE_EMULATOR_HOST"] ?? null,
  mode: isProduction ? "prod" : "dev",
});

/**
 * Releases what outlives a request before the process goes.
 *
 * The live view holds a browser context open across the whole session, and
 * `--watch` restarts this file on every edit. Without a teardown each restart
 * strands another context, and a morning's work leaves a browser full of
 * orphaned pages. The device sources own that, so they are asked to close;
 * anything that fails is logged rather than raised, since the process is
 * leaving either way.
 */
/** Long enough for a healthy teardown, short enough that Ctrl-C still feels like one. */
const SHUTDOWN_TIMEOUT_MS = 3000;

let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    // Guarded because a second Ctrl-C while the first teardown is in flight
    // would otherwise close the same context twice.
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    void (async () => {
      try {
        // Bounded: a wedged browser or a gRPC channel that never answers would
        // otherwise hold the process open until something sends SIGKILL, and
        // the point of this handler is that Ctrl-C works.
        await Promise.race([
          device.close(),
          new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS)),
        ]);
      } catch (error) {
        logger.warn("server.shutdown_failed", errorFields(error));
      }
      cdp.close();
      logger.info("server.stopped", { signal });
      process.exit(0);
    })();
  });
}

export default { port, fetch: app.fetch, websocket };
