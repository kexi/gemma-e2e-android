import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scenarioCommand } from "./scenario.ts";
import { captureContext, withServer } from "../testing.ts";
import { UsageError } from "../usage.ts";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "gemma-cli-scenario-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const VALID = ["title: Login", "cases:", "  - id: valid", "    prompt: log in"].join("\n");

async function write(name: string, body: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, body, "utf8");
  return path;
}

const SCENARIOS = [
  { id: "login", title: "Login", cases: [{ id: "valid", prompt: "log in", maxSteps: 20 }] },
];

describe("scenario list", () => {
  test("lists every scenario the server reports", async () => {
    await withServer(
      () => Response.json({ scenarios: SCENARIOS }),
      async (client) => {
        const { context, out } = captureContext(client);

        expect(await scenarioCommand([], context, "list")).toBe(0);
        expect(out.join("\n")).toContain("login  Login  1");
      },
    );
  });

  test("prints the raw listing when --json is given", async () => {
    await withServer(
      () => Response.json({ scenarios: SCENARIOS }),
      async (client) => {
        const { context, out } = captureContext(client, { json: true });

        await scenarioCommand(["--json"], context, "list");

        expect(JSON.parse(out[0] ?? "")).toEqual(SCENARIOS);
      },
    );
  });
});

describe("scenario get", () => {
  test("shows the requested scenario and its cases", async () => {
    await withServer(
      () => Response.json({ scenarios: SCENARIOS }),
      async (client) => {
        const { context, out } = captureContext(client);

        expect(await scenarioCommand(["login"], context, "get")).toBe(0);
        expect(out.join("\n")).toContain("id     login");
        expect(out.join("\n")).toContain("valid  log in");
      },
    );
  });

  test("exits 2 with a message when the id is not in the listing", async () => {
    await withServer(
      () => Response.json({ scenarios: SCENARIOS }),
      async (client) => {
        const { context, err } = captureContext(client);

        expect(await scenarioCommand(["ghost"], context, "get")).toBe(2);
        expect(err).toEqual(["no such scenario: ghost"]);
      },
    );
  });

  test("requires an id", async () => {
    await withServer(
      () => Response.json({ scenarios: SCENARIOS }),
      async (client) => {
        const { context } = captureContext(client);

        expect(scenarioCommand([], context, "get")).rejects.toBeInstanceOf(UsageError);
      },
    );
  });
});

describe("scenario apply", () => {
  test("creates a scenario the server does not have yet", async () => {
    const path = await write("login.yaml", VALID);
    const methods: string[] = [];

    await withServer(
      (request) => {
        methods.push(request.method);
        return Response.json(
          { scenario: SCENARIOS[0], path: "scenarios/login.yaml" },
          {
            status: 201,
          },
        );
      },
      async (client) => {
        const { context, out } = captureContext(client);

        expect(await scenarioCommand([path], context, "apply")).toBe(0);
        expect(methods).toEqual(["POST"]);
        expect(out.join("\n")).toContain("created login");
      },
    );
  });

  test("updates through PUT when the POST reports the scenario already exists", async () => {
    const path = await write("login.yaml", VALID);
    const methods: string[] = [];

    await withServer(
      (request) => {
        methods.push(request.method);
        const isCreate = request.method === "POST";
        // The server refuses to overwrite through POST because the files are
        // git-managed, so 409 is the signal to edit instead.
        return isCreate
          ? Response.json({ error: 'scenario "login" already exists' }, { status: 409 })
          : Response.json({ scenario: SCENARIOS[0], path: "scenarios/login.yaml" });
      },
      async (client) => {
        const { context, out } = captureContext(client);

        expect(await scenarioCommand([path], context, "apply")).toBe(0);
        expect(methods).toEqual(["POST", "PUT"]);
        expect(out.join("\n")).toContain("updated login");
      },
    );
  });

  test("exits 2 without contacting the server when a file is not a valid scenario", async () => {
    const path = await write("broken.yaml", "title: Login\ncases: []");
    let requests = 0;

    await withServer(
      () => {
        requests += 1;
        return Response.json({});
      },
      async (client) => {
        const { context, err } = captureContext(client);

        expect(await scenarioCommand([path], context, "apply")).toBe(2);
        expect(requests).toBe(0);
        expect(err.join("\n")).toContain("at least one case");
      },
    );
  });

  test("exits 2 when the server rejects the scenario", async () => {
    const path = await write("login.yaml", VALID);

    await withServer(
      () => Response.json({ error: "id must be a lowercase slug" }, { status: 400 }),
      async (client) => {
        const { context, err } = captureContext(client);

        expect(await scenarioCommand([path], context, "apply")).toBe(2);
        expect(err.join("\n")).toContain("id must be a lowercase slug");
      },
    );
  });

  test("attempts every file even after one fails, and fails the command overall", async () => {
    const broken = await write("broken.yaml", "not: a scenario");
    const good = await write("login.yaml", VALID);
    let applied = 0;

    await withServer(
      () => {
        applied += 1;
        return Response.json(
          { scenario: SCENARIOS[0], path: "scenarios/login.yaml" },
          {
            status: 201,
          },
        );
      },
      async (client) => {
        const { context, out, err } = captureContext(client);

        expect(await scenarioCommand([broken, good], context, "apply")).toBe(2);
        expect(applied).toBe(1);
        expect(out.join("\n")).toContain("created login");
        expect(err.length).toBe(1);
      },
    );
  });

  test("requires at least one file", async () => {
    await withServer(
      () => Response.json({}),
      async (client) => {
        const { context } = captureContext(client);

        expect(scenarioCommand([], context, "apply")).rejects.toBeInstanceOf(UsageError);
      },
    );
  });
});

describe("scenario delete", () => {
  test("deletes the named scenario", async () => {
    await withServer(
      (request) => {
        const isDelete = request.method === "DELETE";
        return isDelete
          ? new Response(null, { status: 204 })
          : Response.json({ error: "unexpected" }, { status: 500 });
      },
      async (client) => {
        const { context, out } = captureContext(client);

        expect(await scenarioCommand(["login"], context, "delete")).toBe(0);
        expect(out).toEqual(["deleted login"]);
      },
    );
  });

  test("surfaces the server's error for a scenario that is not there", async () => {
    await withServer(
      () => Response.json({ error: "no such scenario: ghost" }, { status: 404 }),
      async (client) => {
        const { context } = captureContext(client);

        expect(scenarioCommand(["ghost"], context, "delete")).rejects.toThrow(
          "no such scenario: ghost",
        );
      },
    );
  });
});

describe("scenario", () => {
  test("rejects an unknown subcommand and a missing one", () => {
    const { context } = captureContext(undefined as never);

    expect(scenarioCommand([], context, "bogus")).rejects.toBeInstanceOf(UsageError);
    expect(scenarioCommand([], context, null)).rejects.toBeInstanceOf(UsageError);
  });

  test("answers --help for a subcommand without contacting the server", async () => {
    const { context } = captureContext(undefined as never);

    const error = await scenarioCommand(["--help"], context, "apply").catch((e: unknown) => e);

    expect((error as { output: string }).output).toContain("Usage: gemma-e2e scenario apply");
  });
});
