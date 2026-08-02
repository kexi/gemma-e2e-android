import { describe, expect, test } from "bun:test";
import {
  ApiClient,
  ApiError,
  ConnectionError,
  InvalidServerError,
  resolveServer,
} from "./client.ts";
import { rejection, rejectionOf, withServer } from "./testing.ts";

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

  test("reports a 2xx that is not JSON as a server error, not as a parser's complaint", async () => {
    await withServer(
      // What a proxy or a captive portal in front of the dashboard answers:
      // a perfectly successful response to a request the API never saw.
      () => new Response("<html>Sign in</html>", { headers: { "content-type": "text/html" } }),
      async (client) => {
        const error = await rejection(client.listRuns());

        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).status).toBe(200);
        expect(error.message).toContain("not JSON");
        // The raw SyntaxError this replaces named a token, not the problem.
        expect(error.message).not.toContain("Unexpected token");
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

  test("rejects a value that is not a URL instead of blaming the server", () => {
    const resolve = () => resolveServer("not-a-url", {});

    expect(resolve).toThrow(InvalidServerError);
    expect(resolve).toThrow("not a URL");
    // The offending value is quoted so an empty or blank one is still visible.
    expect(resolve).toThrow('"not-a-url"');
    // The "is it running?" guidance would be wrong here: nothing was
    // contacted. Read off the thrown value rather than `not.toThrow`, which
    // would also pass if the call stopped throwing altogether.
    expect(rejectionOf(resolve).message).not.toContain("just web");
  });

  test("rejects an empty --server rather than reporting an empty address", () => {
    // `--server=` reaches resolveServer as "", which the old code passed
    // straight to fetch and reported as "cannot reach the server at .".
    expect(() => resolveServer("", {})).toThrow(InvalidServerError);
    expect(() => resolveServer("", {})).toThrow('""');
  });

  test("rejects a scheme fetch cannot address", () => {
    expect(() => resolveServer("ftp://example.test", {})).toThrow(InvalidServerError);
    expect(() => resolveServer("mailto:someone@example.test", {})).toThrow(InvalidServerError);
  });

  test("rejects an unusable GEMMA_E2E_SERVER the same way as the flag", () => {
    expect(() => resolveServer(undefined, { GEMMA_E2E_SERVER: "not-a-url" })).toThrow(
      InvalidServerError,
    );
  });

  // The guard above must not creep into rejecting addresses that work. Without
  // this, tightening it (requiring a port, a dotted host, no trailing slash)
  // would pass the suite while breaking real deployments.
  test.each([
    "http://localhost:5175",
    "http://127.0.0.1:5175",
    "http://127.0.0.1:5175/",
    "http://localhost:5175/base/path",
    "https://gemma.example.com",
    "https://gemma.example.com/",
    "http://build-box",
    "http://ci-runner.internal:8080",
    "http://[::1]:5175",
  ])("accepts the usable address %s", (server) => {
    expect(resolveServer(server, {})).toBe(server);
  });
});
