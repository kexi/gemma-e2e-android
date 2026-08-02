import type { Run, Scenario } from "@gemma-e2e/core/schema";

export const DEFAULT_SERVER = "http://127.0.0.1:5175";

export interface ModelInfo {
  id: string;
}

export interface DeviceStatus {
  uptimeMs: number | null;
  booted: boolean;
  hardwareConfig: Record<string, string>;
}

export interface CreateRunRequest {
  scenarioId?: string;
  prompt?: string;
  title?: string;
  model?: string;
}

/** An HTTP answer the CLI has to branch on -- 409 drives the apply upsert, 404 the watch retry. */
export class ApiError extends Error {
  override readonly name = "ApiError";

  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * A server that is not listening. Separated from ApiError because there is no
 * status to report and the remedy is different: start the dashboard.
 */
export class ConnectionError extends Error {
  override readonly name = "ConnectionError";

  constructor(
    readonly server: string,
    options?: { cause?: unknown },
  ) {
    super(
      `cannot reach the server at ${server}. Is it running? Start it with \`just web\`.`,
      options,
    );
  }
}

export class ApiClient {
  readonly #server: string;

  constructor(server: string) {
    // Trailing slashes are stripped once here so every path below can be
    // written as an absolute "/api/..." without doubling the separator.
    this.#server = server.replace(/\/+$/, "");
  }

  get server(): string {
    return this.#server;
  }

  url(path: string): string {
    return `${this.#server}${path}`;
  }

  /**
   * Bare fetch with only the connection failure translated. Callers that need
   * the raw Response (SSE, 204, 409 probing) use this; the rest use #json.
   */
  async fetch(path: string, init?: RequestInit): Promise<Response> {
    try {
      return await fetch(this.url(path), init);
    } catch (cause) {
      throw new ConnectionError(this.#server, { cause });
    }
  }

  async #json<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.fetch(path, init);
    if (!res.ok) {
      throw await toApiError(res, init?.method ?? "GET", path);
    }
    return (await res.json()) as T;
  }

  listScenarios(): Promise<{ scenarios: Scenario[] }> {
    return this.#json("/api/scenarios");
  }

  createScenario(scenario: Scenario): Promise<{ scenario: Scenario; path: string }> {
    return this.#json("/api/scenarios", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(scenario),
    });
  }

  updateScenario(scenario: Scenario): Promise<{ scenario: Scenario; path: string }> {
    return this.#json(`/api/scenarios/${encodeURIComponent(scenario.id)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(scenario),
    });
  }

  /** Answers 204 with no body, so the status is read directly rather than parsed. */
  async deleteScenario(id: string): Promise<void> {
    const path = `/api/scenarios/${encodeURIComponent(id)}`;
    const res = await this.fetch(path, { method: "DELETE" });
    if (!res.ok) {
      throw await toApiError(res, "DELETE", path);
    }
  }

  listRuns(): Promise<{ runs: Run[] }> {
    return this.#json("/api/runs");
  }

  getRun(id: string): Promise<{ run: Run }> {
    return this.#json(`/api/runs/${encodeURIComponent(id)}`);
  }

  createRun(body: CreateRunRequest): Promise<{ runId: string }> {
    return this.#json("/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  listModels(): Promise<{ models: ModelInfo[] }> {
    return this.#json("/api/models");
  }

  getDevice(): Promise<{ device: DeviceStatus }> {
    return this.#json("/api/device/status");
  }
}

/**
 * The API reports failures as `{ error }`, so the body is preferred over a
 * synthesized message. Falls back when the body is absent or not JSON, which
 * is what a proxy or a wrong port returns.
 */
async function toApiError(res: Response, method: string, path: string): Promise<ApiError> {
  const body = (await res.json().catch(() => ({}))) as { error?: unknown };
  const detail = typeof body.error === "string" ? body.error : null;
  return new ApiError(res.status, detail ?? `${method} ${path} failed (${res.status})`);
}

/** Resolution order: flag, then environment, then the dashboard's default port. */
export function resolveServer(flag: string | undefined, env: NodeJS.ProcessEnv): string {
  const fromEnv = env.GEMMA_E2E_SERVER;
  const hasEnv = fromEnv !== undefined && fromEnv !== "";
  return flag ?? (hasEnv ? fromEnv : DEFAULT_SERVER);
}
