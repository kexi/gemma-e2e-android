import { type Logger, noopLogger } from "@gemma-e2e/logger";

export interface ModelInfo {
  id: string;
}

/** Injection seam: tests supply a stub instead of reaching LM Studio. */
export type FetchLike = (url: string) => Promise<Response>;

export interface ListModelsOptions {
  baseURL: string;
  fetch?: FetchLike | undefined;
  logger?: Logger | undefined;
}

interface ModelsResponse {
  data?: { id?: unknown }[];
}

/**
 * Embedding models answer /v1/models alongside chat models but cannot produce a
 * decision, so offering one in the dropdown would only yield a failed run. The
 * OpenAI-compatible listing carries no capability flag, which leaves the id as
 * the only signal available.
 */
export function isDecisionModel(id: string): boolean {
  const normalized = id.toLowerCase();
  return !normalized.includes("embed");
}

/**
 * Lists the models the configured endpoint serves.
 *
 * Proxied through the server rather than fetched from the browser: LM Studio
 * sends no CORS headers, so a direct call from the dashboard origin is blocked.
 */
export async function listModels(options: ListModelsOptions): Promise<ModelInfo[]> {
  const doFetch = options.fetch ?? fetch;
  const log = options.logger ?? noopLogger;

  const url = `${options.baseURL.replace(/\/$/, "")}/models`;
  const res = await doFetch(url);

  const failed = !res.ok;
  if (failed) {
    throw new Error(`GET ${url} failed (${res.status})`);
  }

  const body = (await res.json()) as ModelsResponse;
  const ids = (body.data ?? [])
    .map((entry) => entry.id)
    .filter((id): id is string => typeof id === "string" && id !== "")
    .filter(isDecisionModel)
    .sort();

  log.debug("models.listed", { count: ids.length });
  return ids.map((id) => ({ id }));
}
