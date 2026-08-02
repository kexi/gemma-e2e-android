import { describe, expect, test } from "bun:test";
import { ApiClient, ApiError, ConnectionError, resolveServer } from "./client.ts";
import { rejection, withServer } from "./testing.ts";

describe("ApiClient", () => {
  test("returns the parsed body of a successful request", async () => {
    await withServer(
      () => Response.json({ scenarios: [{ id: "login", title: "Login", cases: [] }] }),
      async (client) => {
        const { scenarios } = await client.listScenarios();

        expect(scenarios).toHaveLength(1);
        expect(scenarios[0]?.id).toBe("login");
      },
    );
  });

  test("reports the server's error message and status for a failed request", async () => {
    await withServer(
      () => Response.json({ error: 'scenario "login" already exists' }, { status: 409 }),
      async (client) => {
        const error = await rejection(
          client.createScenario({ id: "login", title: "Login", cases: [] }),
        );

        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).status).toBe(409);
        expect(error.message).toBe('scenario "login" already exists');
      },
    );
  });

  test("falls back to a synthesized message when the failure body is not JSON", async () => {
    await withServer(
      () => new Response("<html>Bad Gateway</html>", { status: 502 }),
      async (client) => {
        const error = await rejection(client.listRuns());

        expect((error as ApiError).status).toBe(502);
        expect(error.message).toBe("GET /api/runs failed (502)");
      },
    );
  });

  test("treats a 204 delete as success and a 404 delete as an error", async () => {
    await withServer(
      (request) => {
        const isKnown = new URL(request.url).pathname === "/api/scenarios/login";
        return isKnown
          ? new Response(null, { status: 204 })
          : Response.json({ error: "no such scenario: ghost" }, { status: 404 });
      },
      async (client) => {
        expect(await client.deleteScenario("login")).toBeUndefined();

        const error = await rejection(client.deleteScenario("ghost"));
        expect((error as ApiError).status).toBe(404);
        expect(error.message).toBe("no such scenario: ghost");
      },
    );
  });

  test("points at `just web` when the server is not listening", async () => {
    // Port 1 is privileged and unbound, so the connection is refused rather
    // than left hanging on a timeout.
    const client = new ApiClient("http://127.0.0.1:1");

    const error = await rejection(client.listRuns());

    expect(error).toBeInstanceOf(ConnectionError);
    expect(error.message).toContain("just web");
    expect(error.message).toContain("http://127.0.0.1:1");
  });

  test("strips a trailing slash from the server so paths do not double up", () => {
    expect(new ApiClient("http://example.test:5175/").url("/api/runs")).toBe(
      "http://example.test:5175/api/runs",
    );
  });

  test("encodes ids that would otherwise change the request path", async () => {
    await withServer(
      (request) => Response.json({ run: { id: new URL(request.url).pathname } }),
      async (client) => {
        const { run } = await client.getRun("a/b");

        expect(run.id).toBe("/api/runs/a%2Fb");
      },
    );
  });
});

describe("resolveServer", () => {
  test("prefers the flag over the environment and the default", () => {
    expect(resolveServer("http://flag.test", { GEMMA_E2E_SERVER: "http://env.test" })).toBe(
      "http://flag.test",
    );
  });

  test("falls back to GEMMA_E2E_SERVER when no flag is given", () => {
    expect(resolveServer(undefined, { GEMMA_E2E_SERVER: "http://env.test" })).toBe(
      "http://env.test",
    );
  });

  test("falls back to the local dashboard port when nothing is set", () => {
    expect(resolveServer(undefined, {})).toBe("http://127.0.0.1:5175");
    expect(resolveServer(undefined, { GEMMA_E2E_SERVER: "" })).toBe("http://127.0.0.1:5175");
  });
});
