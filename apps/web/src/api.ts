import type { CaseRun, Run, Scenario, Step, TestCase } from "@gemma-e2e/core/schema";

export type { CaseRun, Run, Scenario, Step, TestCase };

export interface ModelInfo {
  id: string;
}

export interface CreateRunRequest {
  scenarioId?: string;
  prompt?: string;
  title?: string;
  model?: string;
}

async function json<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${init?.method ?? "GET"} ${input} failed (${res.status})`);
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
  id: string;
  title: string;
  app?: { package: string; activity?: string };
  model?: string;
  cases: { id: string; title?: string; prompt: string; model?: string; maxSteps?: number }[];
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
