import type {
  AccessibilitySettings,
  CaseRun,
  Run,
  Scenario,
  Step,
  Target,
  TestCase,
} from "@gemma-e2e/core/schema";

export type { CaseRun, Run, Scenario, Step, Target, TestCase };

export interface ModelInfo {
  id: string;
}

export interface CreateRunRequest {
  scenarioId?: string;
  prompt?: string;
  title?: string;
  model?: string;
}

/**
 * A batch that got part of the way through before the store refused a write.
 *
 * Why an Error subclass rather than a resolved result the caller inspects: this
 * IS a failure -- the user asked for N runs and got fewer -- so every existing
 * `catch` that only shows the message keeps working, and the callers that can
 * do better narrow on the type. A plain Error would drop `acceptedRunIds` on
 * the floor, and the ids are the only record of which scenarios are already on
 * the device: retrying the whole batch would run them a second time.
 */
export class PartialBatchError extends Error {
  readonly acceptedRunIds: string[];

  constructor(message: string, acceptedRunIds: string[]) {
    super(message);
    this.name = "PartialBatchError";
    this.acceptedRunIds = acceptedRunIds;
  }
}

/** The shape every failing endpoint answers with; `runIds` only on a batch. */
interface ErrorBody {
  error?: string;
  runIds?: unknown;
}

/**
 * Whether a failure body named runs that were accepted before it failed.
 *
 * Lives beside the parsing rather than in the batch call because `json` is the
 * one place a non-ok response is turned into a throw, and a helper that only
 * the batch path used would mean a second `res.json()` on a body already read.
 */
function acceptedRunIdsOf(body: ErrorBody): string[] | null {
  const given = body.runIds;
  const isIdList = Array.isArray(given) && given.every((one) => typeof one === "string");
  if (!isIdList) {
    return null;
  }
  return given;
}

async function json<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as ErrorBody;
    const message = body.error ?? `${init?.method ?? "GET"} ${input} failed (${res.status})`;

    const accepted = acceptedRunIdsOf(body);
    const isPartial = accepted !== null;
    if (isPartial) {
      throw new PartialBatchError(message, accepted);
    }

    throw new Error(message);
  }
  return (await res.json()) as T;
}

export function fetchScenarios(): Promise<{ scenarios: Scenario[] }> {
  return json("/api/scenarios");
}

/**
 * What the builder posts. `maxSteps` is optional here because the server
 * defaults it, so a case left blank still gets a step budget.
 */
export interface CreateScenarioRequest {
  accessibility?: AccessibilitySettings;
  id: string;
  title: string;
  /**
   * Optional here although the schema defaults it to `[]`, because this is the
   * request rather than the parsed scenario: a form that never showed a tags
   * field must be able to omit the key instead of asserting "no tags".
   */
  tags?: string[];
  target?: Target;
  model?: string;
  cases: {
    accessibility?: AccessibilitySettings;
    id: string;
    title?: string;
    prompt: string;
    model?: string;
    target?: Target;
    maxSteps?: number;
  }[];
}

export function createScenario(
  body: CreateScenarioRequest,
): Promise<{ scenario: Scenario; path: string }> {
  return json("/api/scenarios", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * Rewrites `scenarios/<id>.yaml` in place. Same body as the create request:
 * the file is replaced whole rather than patched, so the editor always sends
 * the complete scenario it is showing.
 */
export function updateScenario(
  body: CreateScenarioRequest,
): Promise<{ scenario: Scenario; path: string }> {
  return json(`/api/scenarios/${encodeURIComponent(body.id)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * Deletes `scenarios/<id>.yaml`. Answers 204 with no body, so this reads the
 * status directly rather than going through `json`, which expects one.
 */
export async function deleteScenario(id: string): Promise<void> {
  const res = await fetch(`/api/scenarios/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `DELETE /api/scenarios/${id} failed (${res.status})`);
  }
}

export function fetchRuns(): Promise<{ runs: Run[] }> {
  return json("/api/runs");
}

export function fetchRun(id: string): Promise<{ run: Run }> {
  return json(`/api/runs/${encodeURIComponent(id)}`);
}

export function createRun(body: CreateRunRequest): Promise<{ runId: string }> {
  return json("/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * Starts one run per scenario id, in the order given.
 *
 * Why not call `createRun` in a loop from the browser: the server serialises
 * the ids into a single queue, and `startedAt` is the sort key the history
 * lists by. Separate requests race each other over the network, so the rail
 * would show the batch in an order the user never asked for. One request also
 * means one 404: an unknown id rejects the whole batch before anything runs.
 */
export function createRunBatch(scenarioIds: string[]): Promise<{ runIds: string[] }> {
  return json("/api/runs/batch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scenarioIds }),
  });
}

export function fetchModels(): Promise<{ models: ModelInfo[] }> {
  return json("/api/models");
}

/**
 * Screenshots are served from the run directory, so the URL is the last three
 * path segments: `<runId>/<caseId>/<index>.png`.
 */
export function screenshotUrl(storedPath: string): string {
  const name = storedPath.split("/").slice(-3).join("/");
  return `/screenshots/${name}`;
}

/**
 * Recordings are one file per case under the run directory, so the URL is the
 * last two path segments: `<runId>/<caseId>.mp4`.
 */
export function videoUrl(storedPath: string): string {
  const name = storedPath.split("/").slice(-2).join("/");
  return `/videos/${name}`;
}
