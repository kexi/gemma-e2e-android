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

/**
 * A --server / GEMMA_E2E_SERVER value that is not a URL at all. Separated from
 * ConnectionError because no amount of starting the dashboard fixes it, and the
 * request is refused before it is attempted.
 */
export class InvalidServerError extends Error {
  override readonly name = "InvalidServerError";

  constructor(readonly server: string) {
    // Why not UsageError: that class appends "Try '<command path>' --help",
    // and the path it carries is the subcommand that happened to be typed
    // ("run list"). --server is a global flag, so that hint would point at a
    // help page which does not document it -- misdirection on top of the
    // mistake. main's fallback branch already prints "gemma-e2e: <msg>" and
    // exits 2, which is the GNU shape this needs without the wrong hint.
    super(
      `invalid --server value ${JSON.stringify(server)}: not a URL. ` +
        `Give an absolute URL with a scheme, e.g. \`--server=${DEFAULT_SERVER}\`.`,
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

/**
 * Resolution order: flag, then environment, then the dashboard's default port.
 * The chosen value is checked here rather than at request time so a typo is
 * reported as the mistake it is, instead of surfacing as "is the server
 * running?" from the fetch that could never have been addressed.
 */
export function resolveServer(flag: string | undefined, env: NodeJS.ProcessEnv): string {
  const fromEnv = env.GEMMA_E2E_SERVER;
  const hasEnv = fromEnv !== undefined && fromEnv !== "";
  const server = flag ?? (hasEnv ? fromEnv : DEFAULT_SERVER);

  const parsed = URL.parse(server);
  const isUrl = parsed !== null;
  if (!isUrl) {
    throw new InvalidServerError(server);
  }

  // Why not accept any parseable URL: "mailto:x" and "ftp://host" parse
  // cleanly but fetch cannot address them, so they would fail later with a
  // message about the server being down. Kept to a scheme check rather than
  // host/port rules, so private hostnames, default ports, and trailing
  // slashes all pass untouched.
  const isHttp = parsed.protocol === "http:" || parsed.protocol === "https:";
  if (!isHttp) {
    throw new InvalidServerError(server);
  }

  return server;
}
