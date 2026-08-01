import { join } from "node:path";
import { AdbClient } from "@gemma-e2e/adb";
import { GenkitLlm, runScenario } from "@gemma-e2e/agent";
import { Store } from "@gemma-e2e/store";
import { createApp, type StartRunInput } from "./app.ts";

const DEFAULT_PORT = 5175;

const repoRoot = join(import.meta.dir, "..", "..", "..");
const port = Number(process.env["PORT"] ?? DEFAULT_PORT);
const scenariosDir = process.env["SCENARIOS_DIR"] ?? join(repoRoot, "scenarios");
const varDir = process.env["VAR_DIR"] ?? join(repoRoot, "var");
const screenshotsDir = join(varDir, "screenshots");
const clientDir = join(import.meta.dir, "..", "dist");

const store = Store.open(join(varDir, "runs.db"));

// Constructed once and shared: both hold only configuration, and a device or
// model that is missing surfaces as a run with status=error rather than as a
// startup crash, so the dashboard stays usable without hardware attached.
const adb = new AdbClient({ serial: process.env["ANDROID_SERIAL"] });
const llm = new GenkitLlm({
  baseURL: process.env["LLM_BASE_URL"],
  model: process.env["LLM_MODEL"],
});

function startRun({ runId, scenario, onEvent }: StartRunInput): void {
  // Deliberately not awaited: POST /api/runs answers 202 immediately and the
  // client follows progress over SSE. runScenario already converts every
  // failure into a finished run with status=error, so a rejection here would
  // only mean the store itself is broken.
  void runScenario(scenario, {
    adb,
    llm,
    store,
    screenshotDir: screenshotsDir,
    runId,
    onEvent,
  }).catch((error: unknown) => {
    console.error(`run ${runId} crashed outside the loop:`, error);
  });
}

const isProduction = await Bun.file(join(clientDir, "index.html")).exists();

const app = createApp({
  store,
  scenariosDir,
  startRun,
  screenshotsDir,
  ...(isProduction ? { clientDir } : {}),
});

console.log(`dashboard API on http://localhost:${port} (scenarios: ${scenariosDir})`);

export default { port, fetch: app.fetch };
