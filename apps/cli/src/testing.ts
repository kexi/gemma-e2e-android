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

/** Serialises one SSE frame the way `hono/streaming`'s writeSSE does. */
export function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
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
