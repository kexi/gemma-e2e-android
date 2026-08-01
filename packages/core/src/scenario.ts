import { basename, extname, join } from "node:path";
import { readdir } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { type Scenario, ScenarioSchema } from "./schema.ts";

const YAML_EXTENSIONS = new Set([".yaml", ".yml"]);

export class ScenarioLoadError extends Error {
  override readonly name = "ScenarioLoadError";

  constructor(
    readonly path: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(`${path}: ${message}`, options);
  }
}

/**
 * Reads one YAML scenario. The filename is the fallback `id` so short scenario
 * files need only a title and a list of cases.
 */
export async function loadScenario(path: string): Promise<Scenario> {
  const file = Bun.file(path);

  let raw: string;
  try {
    raw = await file.text();
  } catch (cause) {
    throw new ScenarioLoadError(path, "cannot be read", { cause });
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new ScenarioLoadError(path, `is not valid YAML: ${detail}`, { cause });
  }

  const isMapping = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
  if (!isMapping) {
    throw new ScenarioLoadError(path, "must contain a YAML mapping at the top level");
  }

  const withDefaultId = {
    id: basename(path, extname(path)),
    ...(parsed as Record<string, unknown>),
  };

  const result = ScenarioSchema.safeParse(withDefaultId);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("; ");
    throw new ScenarioLoadError(path, `is not a valid scenario (${issues})`);
  }

  // Checked here rather than in the schema: a case id keys a Firestore document
  // under its run, so a collision would have one case silently overwrite
  // another's steps.
  const seen = new Set<string>();
  for (const testCase of result.data.cases) {
    const isDuplicate = seen.has(testCase.id);
    if (isDuplicate) {
      throw new ScenarioLoadError(path, `contains duplicate case id "${testCase.id}"`);
    }
    seen.add(testCase.id);
  }

  return result.data;
}

/**
 * Loads every `.yaml`/`.yml` file in a directory, sorted by filename so run
 * order is stable across machines. Non-recursive: scenarios are a flat set.
 */
export async function loadScenariosDir(dir: string): Promise<Scenario[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (cause) {
    throw new ScenarioLoadError(dir, "cannot be listed", { cause });
  }

  const yamlFiles = entries
    .filter((entry) => YAML_EXTENSIONS.has(extname(entry).toLowerCase()))
    .sort();

  const scenarios = await Promise.all(yamlFiles.map((name) => loadScenario(join(dir, name))));

  const seen = new Set<string>();
  for (const scenario of scenarios) {
    const isDuplicate = seen.has(scenario.id);
    if (isDuplicate) {
      throw new ScenarioLoadError(dir, `contains duplicate scenario id "${scenario.id}"`);
    }
    seen.add(scenario.id);
  }

  return scenarios;
}
