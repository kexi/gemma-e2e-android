import { errorFields, type Logger, noopLogger } from "@gemma-e2e/logger";

/**
 * The slice of a WebSocket this connection drives. Injectable so the protocol
 * can be tested without a browser: a fake answers commands and pushes events on
 * demand, which is the only way to exercise a timeout or a malformed reply.
 */
export interface SocketLike {
  send(data: string): void;
  close(): void;
  addEventListener(type: "message", handler: (event: { data: unknown }) => void): void;
  addEventListener(type: "close", handler: () => void): void;
  addEventListener(type: "error", handler: (event: unknown) => void): void;
}

export type SocketFactory = (url: string) => SocketLike;

export class CdpError extends Error {
  override readonly name = "CdpError";
}

/** How long one command may wait before the connection gives up on it. */
const DEFAULT_TIMEOUT_MS = 30_000;

export interface CdpConnectionOptions {
  /** Defaults to a no-op, so opening a connection never writes on its own. */
  logger?: Logger | undefined;
  timeoutMs?: number | undefined;
  socket?: SocketFactory | undefined;
}

interface Pending {
  resolve: (result: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  method: string;
}

/** An event as it arrived, with the session that produced it. */
export interface CdpEvent {
  method: string;
  params: Record<string, unknown>;
  /** Absent for browser-level events, which belong to no target. */
  sessionId?: string | undefined;
}

export type EventHandler = (event: CdpEvent) => void;

const defaultSocket: SocketFactory = (url) => new WebSocket(url) as unknown as SocketLike;

/**
 * One WebSocket to Chrome, carrying every target's traffic.
 *
 * CDP is plain JSON-RPC, so this is an id counter, a map of pending replies,
 * and an event dispatcher -- roughly what `chrome-remote-interface` wraps, and
 * not enough to be worth a dependency when the alternative is Puppeteer's whole
 * browser-management layer.
 *
 * Sessions are multiplexed rather than given a socket each: attaching with
 * `flatten: true` tags every message with its `sessionId`, so one connection
 * serves the browser and all its pages. The deprecated alternative wraps each
 * message in a `Target.sendMessageToTarget` envelope.
 */
export class CdpConnection {
  readonly #socket: SocketLike;
  readonly #pending = new Map<number, Pending>();
  readonly #handlers = new Map<string, Set<EventHandler>>();
  readonly #timeoutMs: number;
  readonly #log: Logger;
  #nextId = 1;
  #closed: Error | null = null;

  private constructor(socket: SocketLike, options: CdpConnectionOptions) {
    this.#socket = socket;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#log = options.logger ?? noopLogger;

    socket.addEventListener("message", (event) => {
      this.#receive(event.data);
    });
    socket.addEventListener("close", () => {
      this.#fail(new CdpError("the devtools connection closed"));
    });
    socket.addEventListener("error", (event) => {
      this.#fail(new CdpError(`the devtools connection failed: ${describe(event)}`));
    });
  }

  /**
   * Opens a connection and resolves once the socket is ready to carry commands.
   *
   * Waiting for `open` rather than letting `send` queue: a command issued
   * before the handshake completes is dropped by the socket, and the caller
   * would see a timeout thirty seconds later with nothing to explain it.
   */
  static async open(url: string, options: CdpConnectionOptions = {}): Promise<CdpConnection> {
    const socket = (options.socket ?? defaultSocket)(url);
    const connection = new CdpConnection(socket, options);

    const isReady = (socket as { readyState?: number }).readyState;
    const alreadyOpen = isReady === undefined || isReady === 1;
    if (!alreadyOpen) {
      await new Promise<void>((resolve, reject) => {
        const native = socket as unknown as {
          addEventListener(type: string, handler: () => void): void;
        };
        native.addEventListener("open", resolve);
        native.addEventListener("error", () => {
          reject(new CdpError(`cannot reach devtools at ${url}`));
        });
      });
    }

    options.logger?.debug("cdp.connected", { url });
    return connection;
  }

  /**
   * Issues one command and resolves with its result.
   *
   * `sessionId` routes it to a page; omitted, it addresses the browser itself.
   */
  async send(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string | undefined,
  ): Promise<Record<string, unknown>> {
    const isClosed = this.#closed !== null;
    if (isClosed) {
      throw this.#closed;
    }

    const id = this.#nextId++;
    const message = JSON.stringify({
      id,
      method,
      params,
      ...(sessionId === undefined ? {} : { sessionId }),
    });

    return await new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new CdpError(`${method} did not answer within ${this.#timeoutMs}ms`));
      }, this.#timeoutMs);

      this.#pending.set(id, { resolve, reject, timer, method });

      try {
        this.#socket.send(message);
      } catch (error) {
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(new CdpError(`cannot send ${method}: ${describe(error)}`));
      }
    });
  }

  /** Subscribes to an event. Returns the function that unsubscribes it. */
  on(method: string, handler: EventHandler): () => void {
    const handlers = this.#handlers.get(method) ?? new Set<EventHandler>();
    handlers.add(handler);
    this.#handlers.set(method, handlers);

    return () => {
      handlers.delete(handler);
    };
  }

  close(): void {
    this.#fail(new CdpError("the devtools connection was closed"));
    this.#socket.close();
  }

  #receive(data: unknown): void {
    const isText = typeof data === "string";
    if (!isText) {
      return;
    }

    let message: Record<string, unknown>;
    try {
      message = JSON.parse(data) as Record<string, unknown>;
    } catch {
      // Nothing addressable to fail, since a reply is matched by its id and an
      // unparseable frame has none. The command times out instead.
      this.#log.warn("cdp.unparseable_frame", { bytes: data.length });
      return;
    }

    const id = message["id"];
    const isReply = typeof id === "number";
    if (isReply) {
      this.#settle(id, message);
      return;
    }

    const method = message["method"];
    const isEvent = typeof method === "string";
    if (isEvent) {
      this.#dispatch({
        method,
        params: (message["params"] as Record<string, unknown>) ?? {},
        ...(typeof message["sessionId"] === "string" ? { sessionId: message["sessionId"] } : {}),
      });
    }
  }

  #settle(id: number, message: Record<string, unknown>): void {
    const pending = this.#pending.get(id);
    const isUnknown = pending === undefined;
    if (isUnknown) {
      // A reply to a command that already timed out. Its waiter is long gone.
      return;
    }

    this.#pending.delete(id);
    clearTimeout(pending.timer);

    const error = message["error"] as { message?: string; data?: string } | undefined;
    const failed = error !== undefined;
    if (failed) {
      const detail = [error.message, error.data].filter(Boolean).join(": ");
      pending.reject(new CdpError(`${pending.method} failed: ${detail || "unknown error"}`));
      return;
    }

    pending.resolve((message["result"] as Record<string, unknown>) ?? {});
  }

  #dispatch(event: CdpEvent): void {
    const handlers = this.#handlers.get(event.method);
    const hasNone = handlers === undefined;
    if (hasNone) {
      return;
    }

    // Copied before iterating rather than iterated in place: a handler that
    // unsubscribes itself -- which the screencast fan-out does on its last
    // client -- would otherwise mutate the set mid-loop. `Array.from` says so
    // where a spread reads as an accident.
    for (const handler of Array.from(handlers)) {
      try {
        handler(event);
      } catch (error) {
        // One bad subscriber must not stop the others, nor take down the
        // socket that feeds every session.
        this.#log.warn("cdp.handler_failed", { method: event.method, ...errorFields(error) });
      }
    }
  }

  /** Rejects everything still waiting; the socket can no longer answer it. */
  #fail(error: Error): void {
    const alreadyFailed = this.#closed !== null;
    if (alreadyFailed) {
      return;
    }
    this.#closed = error;

    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
  }
}

function describe(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
