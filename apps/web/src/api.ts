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
