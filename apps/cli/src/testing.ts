import type { Socket } from "bun";
import { ApiClient, ConnectionError } from "./client.ts";
import type { Context } from "./context.ts";
import { plain } from "./render.ts";

export type Handler = (request: Request) => Response | Promise<Response>;

export interface Captured {
  context: Context;
  out: string[];
  err: string[];
}

/**
 * A Context wired to `client` that records output instead of writing it.
 * Colour is off so assertions compare plain strings.
 */
export function captureContext(client: ApiClient, options: { json?: boolean } = {}): Captured {
  const out: string[] = [];
  const err: string[] = [];
  return {
    context: {
      client,
      json: options.json === true,
      style: plain,
      out: (line) => out.push(line),
      err: (line) => err.push(line),
      env: {},
    },
    out,
    err,
  };
}

/**
 * A tag every throwaway server echoes, so a client can tell it is talking to
 * the server this suite started rather than to whatever else answered.
 */
const SERVER_TAG_HEADER = "x-gemma-e2e-test-server";

/** How many ports to try before giving up on finding one nobody else holds. */
const PORT_ATTEMPTS = 40;

let nextServerTag = 0;

/**
 * Stands a server up on a port that nothing else is listening on, and answers
 * with `tag` on every response so a stray reply can be spotted.
 *
 * *Why not just `Bun.serve({ port: 0 })` and trust the kernel:* `port: 0` draws
 * from the same ephemeral range that every other process on the machine draws
 * from, and a developer laptop is full of them -- Electron apps, language
 * servers, VM helpers all sit on 127.0.0.1 in the 49152-65535 window. Binding
 * is not what collides; the kernel will happily give this process a port a
 * *different* process already holds on the same address, and then a request
 * meant for a two-line test handler is answered by somebody's editor with a
 * 403. That is the residual flake this suite could not otherwise explain: a
 * failing POST /api/runs (403) with no 403 anywhere in the repository.
 */
function serveOnFreePort(handler: Handler): { server: ReturnType<typeof Bun.serve>; tag: string } {
  const tag = `t${(nextServerTag += 1)}`;
  for (let attempt = 0; attempt < PORT_ATTEMPTS; attempt += 1) {
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const response = await handler(request);
        response.headers.set(SERVER_TAG_HEADER, tag);
        return response;
      },
    });

    const isTaken = isPortHeldByAnother(server.port);
    if (!isTaken) {
      return { server, tag };
    }
    void server.stop(true);
  }
  throw new Error(`could not find a free port after ${PORT_ATTEMPTS} attempts`);
}

/**
 * Whether some *other* listener is already bound to `port` on 127.0.0.1.
 *
 * Bun's own listener is bound to the wildcard address, so a second bind
 * specifically to 127.0.0.1 succeeds when the port is otherwise clear and fails
 * with EADDRINUSE exactly when a foreign process holds it.
 */
function isPortHeldByAnother(port: number | undefined): boolean {
  const isUnbound = port === undefined;
  if (isUnbound) {
    return true;
  }
  try {
    const probe = Bun.listen({ hostname: "127.0.0.1", port, socket: { data() {} } });
    probe.stop(true);
    return false;
  } catch {
    return true;
  }
}

/**
 * How many times a request against a throwaway server is re-sent when the
 * connection itself fails. Small: this covers a lost connection to a server
 * known to be listening, not a server that is genuinely down.
 */
const CONNECTION_RETRIES = 4;

/**
 * An ApiClient for a server this suite started: it rejects a reply that came
 * from somewhere else, and re-sends a request whose connection died.
 *
 * The tag check is for the port *collision*. `Bun.serve({ port: 0 })` binds the
 * wildcard address, and the kernel will hand it a port another process already
 * holds on 127.0.0.1 -- verified directly: a wildcard bind onto an occupied
 * loopback port succeeds, and the request that follows is answered by the
 * stranger. That is where a `POST /api/runs failed (403)` came from in a
 * repository with no 403 in it. serveOnFreePort avoids those ports; this check
 * is the backstop that names the problem if one is ever reached anyway, rather
 * than letting it read as the handler's own answer.
 *
 * The retry is for the port *churn*. Standing a server up and tearing it down
 * per test, across a concurrent suite, leaves a small rate of requests that
 * lose their connection to a server that is listening and about to answer.
 *
 * *Why not put the retry in ApiClient itself:* it is only correct because the
 * server here is known to be up, so a dead connection can only be the teardown
 * race. Against a real dashboard that same failure is the honest answer
 * "nothing is listening", which the CLI reports as ConnectionError and which
 * several tests assert on.
 *
 * *Why not retry around `body` in withServer:* the tests count requests, so
 * replaying the whole body would double the `lookups` their assertions read.
 */
class TaggedApiClient extends ApiClient {
  readonly #tag: string;

  constructor(server: string, tag: string) {
    super(server);
    this.#tag = tag;
  }

  override async fetch(path: string, init?: RequestInit): Promise<Response> {
    for (let attempt = 0; ; attempt += 1) {
      const isLast = attempt === CONNECTION_RETRIES - 1;
      try {
        return await this.#fetchOnce(path, init);
      } catch (error) {
        const isConnection = error instanceof ConnectionError;
        if (!isConnection || isLast) {
          throw error;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  async #fetchOnce(path: string, init?: RequestInit): Promise<Response> {
    const response = await super.fetch(path, init);
    const isOurs = response.headers.get(SERVER_TAG_HEADER) === this.#tag;
    if (!isOurs) {
      throw new Error(
        `${path} was answered by a foreign server on ${this.server} ` +
          `(${response.status}); the ephemeral port collided with another process`,
      );
    }
    return response;
  }
}

/**
 * Runs `body` against a throwaway HTTP server on an ephemeral port.
 *
 * A real server rather than a stubbed `fetch`: the CLI's interesting behaviour
 * is in what it does with statuses and streaming bodies, and the repository has
 * no mocking library to reach for anyway.
 */
export async function withServer(
  handler: Handler,
  body: (client: ApiClient, server: { url: string }) => Promise<void>,
): Promise<void> {
  const { server, tag } = serveOnFreePort(handler);
  const origin = `http://127.0.0.1:${server.port}`;
  try {
    await body(new TaggedApiClient(origin, tag), { url: origin });
  } finally {
    // Not awaited: every server here gets its own ephemeral port, so nothing
    // waits on this one's release, and awaiting the drain adds latency to each
    // of the dozens of servers a suite stands up.
    //
    // *Why not `await` it anyway, to order teardown against the rest of the
    // concurrent suite:* a test that deliberately leaves a stream open has
    // nothing for the forced close to reclaim, so the await sits there until
    // the 5s test timeout fires.
    //
    // *Why not drop the `true` and let connections finish on their own:*
    // then the sockets outlive the test that opened them, and the suite's
    // failures spread from the one streaming test to whichever unrelated
    // ApiClient or scenario test is next to reach for a connection.
    void server.stop(true);
  }
}

/**
 * Awaits a promise that is expected to reject and returns the rejection.
 * Typed as unknown-in / Error-out so a test can assert on the failure without
 * widening the success type into every later expectation.
 */
export async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected the promise to reject, but it resolved");
}

/**
 * The synchronous counterpart to `rejection`, for asserting on the message of
 * an error a plain call is expected to throw.
 */
export function rejectionOf(call: () => unknown): Error {
  try {
    call();
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected the call to throw, but it returned");
}

/** Serialises one SSE frame the way `hono/streaming`'s writeSSE does. */
export function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Sends `payload` and then closes, guaranteeing the peer gets the bytes as a
 * readable response before it gets the close.
 *
 * *Why not `socket.write(...)` followed straight by `socket.end()`:* both the
 * data and the FIN then reach the client in the same readable turn, and which
 * one its HTTP parser acts on first is a race it loses a few percent of the
 * time -- `fetch()` itself rejects with ECONNRESET instead of resolving with a
 * response whose *body* later truncates. That difference matters here: a
 * rejected `fetch` is a ConnectionError, which openEvents classifies as
 * "never opened" and answers by polling without printing a frame, so the very
 * events the truncation test asserts on are never rendered. Worse, the aborted
 * connection is racing whatever else the concurrent suite has in flight, which
 * is how an unrelated `withServer` test ends up reporting a dead server.
 *
 * *Why not `socket.flush()` alone:* flush only pushes the buffer at the kernel,
 * which makes the FIN follow the data sooner and so loses the race more often,
 * not less. Yielding a macrotask is what actually separates the two turns.
 */
async function sendThenClose(socket: Socket<undefined>, payload: string): Promise<void> {
  socket.write(payload);
  socket.flush();
  await new Promise((resolve) => setTimeout(resolve, 0));
  socket.end();
}

/**
 * Runs `body` against a server that answers an SSE request by sending `chunks`
 * and then hanging up mid-body, leaving the announced chunked encoding
 * unterminated. Every other request is answered by `handler`.
 *
 * Written at the socket rather than as a Response whose stream errors: erroring
 * a ReadableStream server-side makes Bun close the body cleanly, so the client
 * reads a normal end-of-stream and the truncation under test never happens. A
 * truncated chunked body is what a killed dashboard actually puts on the wire,
 * and it is the one thing that makes the client's read throw.
 */
export async function withTruncatedSseServer(
  chunks: string[],
  handler: Handler,
  body: (client: ApiClient) => Promise<void>,
): Promise<void> {
  const rest = Bun.serve({ port: 0, fetch: handler });
  const front = Bun.listen<undefined>({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      async data(socket, received) {
        const request = received.toString();
        const path = request.split(" ")[1] ?? "/";
        const isEvents = path.endsWith("/events");
        if (isEvents) {
          const frames = chunks
            .map((chunk) => `${Buffer.byteLength(chunk).toString(16)}\r\n${chunk}\r\n`)
            .join("");
          // No terminating zero-length chunk: the body stops mid-stream.
          await sendThenClose(
            socket,
            "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\n" +
              `transfer-encoding: chunked\r\nconnection: close\r\n\r\n${frames}`,
          );
          return;
        }

        const response = await rest.fetch(new Request(`http://127.0.0.1${path}`));
        const text = await response.text();
        await sendThenClose(
          socket,
          `HTTP/1.1 ${response.status} OK\r\ncontent-type: application/json\r\n` +
            `content-length: ${Buffer.byteLength(text)}\r\nconnection: close\r\n\r\n${text}`,
        );
      },
    },
  });

  try {
    await body(new ApiClient(`http://127.0.0.1:${front.port}`));
  } finally {
    front.stop(true);
    void rest.stop(true);
  }
}

/**
 * Runs `body` against a server that hangs up on an SSE request without
 * answering it at all, so the client's fetch fails outright. Every other
 * request is answered by `handler`.
 *
 * Written at the socket for the same reason as withTruncatedSseServer: a
 * Response cannot decline to be a response, and what a restarting dashboard
 * does to a connection it is not ready for is close it unanswered. Only the
 * stream is refused, so the polls that follow still have a server to reach --
 * which is the situation under test, not a wholly dead port.
 */
export async function withRefusedSseServer(
  handler: Handler,
  body: (client: ApiClient) => Promise<void>,
): Promise<void> {
  const rest = Bun.serve({ port: 0, fetch: handler });
  const front = Bun.listen<undefined>({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      async data(socket, received) {
        const request = received.toString();
        const path = request.split(" ")[1] ?? "/";
        const isEvents = path.endsWith("/events");
        if (isEvents) {
          // No status line, no body: the peer goes away mid-request.
          socket.end();
          return;
        }

        const response = await rest.fetch(new Request(`http://127.0.0.1${path}`));
        const text = await response.text();
        await sendThenClose(
          socket,
          `HTTP/1.1 ${response.status} OK\r\ncontent-type: application/json\r\n` +
            `content-length: ${Buffer.byteLength(text)}\r\nconnection: close\r\n\r\n${text}`,
        );
      },
    },
  });

  try {
    await body(new ApiClient(`http://127.0.0.1:${front.port}`));
  } finally {
    front.stop(true);
    void rest.stop(true);
  }
}

/** An SSE response whose body emits `chunks` in order and then closes. */
export function sseResponse(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream" } });
}
