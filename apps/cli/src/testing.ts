import { ApiClient } from "./client.ts";
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
  const server = Bun.serve({ port: 0, fetch: handler });
  const origin = `http://127.0.0.1:${server.port}`;
  try {
    await body(new ApiClient(origin), { url: origin });
  } finally {
    // Not awaited: every server here gets its own ephemeral port, so nothing
    // waits on this one's release, and awaiting the drain adds latency to each
    // of the dozens of servers a suite stands up.
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
          socket.write(
            "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\n" +
              `transfer-encoding: chunked\r\nconnection: close\r\n\r\n${frames}`,
          );
          // No terminating zero-length chunk: the body stops mid-stream.
          socket.end();
          return;
        }

        const response = await rest.fetch(new Request(`http://127.0.0.1${path}`));
        const text = await response.text();
        socket.write(
          `HTTP/1.1 ${response.status} OK\r\ncontent-type: application/json\r\n` +
            `content-length: ${Buffer.byteLength(text)}\r\nconnection: close\r\n\r\n${text}`,
        );
        socket.end();
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
