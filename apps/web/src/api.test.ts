import { afterEach, describe, expect, test } from "bun:test";
import { createRun, createRunBatch, PartialBatchError } from "./api.ts";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

/**
 * `fetch` is stubbed rather than a server started: what is under test is how a
 * failure body is turned into a throw, and a real server would only make the
 * partial-failure case harder to provoke than the client is to describe.
 */
function respondWith(status: number, body: unknown) {
  // The real fetch's own properties are carried over rather than cast away:
  // `typeof fetch` includes React's `preconnect`, so a bare arrow function is
  // not assignable, and casting through `unknown` would only hide that from
  // the next person who changes this.
  const stub: typeof fetch = Object.assign(
    () =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        }),
      ),
    { preconnect: realFetch.preconnect },
  );
  globalThis.fetch = stub;
}

describe("createRunBatch", () => {
  test("carries the ids the server already queued, so the caller can retry only the rest", async () => {
    // The failure this guards: with two scenarios, the first is enqueued and
    // the second's write fails. Dropping runIds leaves the rail no way to know
    // the first is already running, so the user's retry starts it twice.
    respondWith(500, { error: "store unavailable", runIds: ["run-1"] });

    const thrown = await createRunBatch(["login", "shop"]).catch((cause: unknown) => cause);

    expect(thrown).toBeInstanceOf(PartialBatchError);
    expect((thrown as PartialBatchError).acceptedRunIds).toEqual(["run-1"]);
    expect((thrown as PartialBatchError).message).toBe("store unavailable");
  });

  test("reports a batch rejected outright as a plain failure, with nothing accepted", async () => {
    // 404 for an unknown id starts nothing at all, so there is no runIds key
    // and no partial state for the caller to reconcile.
    respondWith(404, { error: "no such scenario: nope" });

    const thrown = await createRunBatch(["nope"]).catch((cause: unknown) => cause);

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(PartialBatchError);
    expect((thrown as Error).message).toBe("no such scenario: nope");
  });

  test("returns the accepted ids in the order they were asked for", async () => {
    respondWith(202, { runIds: ["run-1", "run-2"] });

    expect(await createRunBatch(["login", "shop"])).toEqual({ runIds: ["run-1", "run-2"] });
  });
});

describe("createRun", () => {
  test("reports a failure with the server's message rather than a status code alone", async () => {
    respondWith(500, { error: "device is busy" });

    const thrown = await createRun({ scenarioId: "login" }).catch((cause: unknown) => cause);

    expect((thrown as Error).message).toBe("device is busy");
    expect(thrown).not.toBeInstanceOf(PartialBatchError);
  });

  test("falls back to naming the request when the failure body carries no message", async () => {
    respondWith(503, {});

    const thrown = await createRun({ scenarioId: "login" }).catch((cause: unknown) => cause);

    expect((thrown as Error).message).toBe("POST /api/runs failed (503)");
  });
});
