import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SERVER, resolveServer } from "./client.ts";
import { type Io, main } from "./main.ts";
import { PROGRAM, VERSION } from "./usage.ts";

interface Session {
  code: number;
  out: string;
  err: string;
}

/**
 * Runs the CLI with no reachable server, so anything that would make a request
 * fails on connection. Commands under test here are the ones that answer
 * before any request is made.
 */
async function cli(argv: string[], env: NodeJS.ProcessEnv = {}): Promise<Session> {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    // Port 1 is privileged and unbound, so a request fails fast rather than
    // reaching a dashboard that happens to be running on the usual port.
    env: { GEMMA_E2E_SERVER: "http://127.0.0.1:1", ...env },
    isTty: false,
  };

  const code = await main(argv, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

describe("--version", () => {
  test("prints `gemma-e2e 0.1.0` on the first line of stdout and exits 0", async () => {
    const session = await cli(["--version"]);

    expect(session.code).toBe(0);
    expect(session.out.split("\n")[0]).toBe(`${PROGRAM} ${VERSION}`);
    expect(session.err).toBe("");
  });

  test("is honoured after a subcommand too", async () => {
    for (const argv of [["run", "--version"], ["scenario", "list", "--version"], ["-V"]]) {
      const session = await cli(argv);

      expect(session.code).toBe(0);
      expect(session.out.split("\n")[0]).toBe(`${PROGRAM} ${VERSION}`);
    }
  });
});

describe("--help", () => {
  test("prints usage on stdout and exits 0", async () => {
    const session = await cli(["--help"]);

    expect(session.code).toBe(0);
    expect(session.out).toContain(`Usage: ${PROGRAM} [OPTION]... COMMAND [ARG]...`);
    expect(session.out).toContain("Exit status:");
    expect(session.err).toBe("");
  });

  test("is available for every command group and subcommand", async () => {
    const expected: [string[], string][] = [
      [["scenario", "--help"], "Usage: gemma-e2e scenario COMMAND"],
      [["scenario", "list", "--help"], "Usage: gemma-e2e scenario list"],
      [["scenario", "get", "--help"], "Usage: gemma-e2e scenario get"],
      [["scenario", "apply", "--help"], "Usage: gemma-e2e scenario apply"],
      [["scenario", "delete", "--help"], "Usage: gemma-e2e scenario delete"],
      [["run", "--help"], "Usage: gemma-e2e run COMMAND"],
      [["run", "start", "--help"], "Usage: gemma-e2e run start"],
      [["run", "list", "--help"], "Usage: gemma-e2e run list"],
      [["run", "get", "--help"], "Usage: gemma-e2e run get"],
      [["run", "watch", "--help"], "Usage: gemma-e2e run watch"],
      [["models", "--help"], "Usage: gemma-e2e models"],
      [["device", "--help"], "Usage: gemma-e2e device"],
    ];

    for (const [argv, usage] of expected) {
      const session = await cli(argv);

      expect(session.code).toBe(0);
      expect(session.out).toContain(usage);
      expect(session.err).toBe("");
    }
  });

  test("accepts the -h short form", async () => {
    expect((await cli(["-h"])).out).toContain("Usage:");
  });
});

/**
 * --help and --version describe the program itself, so they must answer
 * whatever the server setting says -- they never address it. Guarding every
 * nesting level because the paths differ: the root is answered before any
 * context exists, a bare group by dispatch, and a subcommand only after its own
 * strict parse, which is the one that regressed.
 */
describe("--help and --version under an unusable server", () => {
  const UNUSABLE = ["not-a-url", "", "ftp://example.test"];

  const helpPaths: [string[], string][] = [
    [["--help"], `Usage: ${PROGRAM} [OPTION]... COMMAND [ARG]...`],
    [["scenario", "--help"], "Usage: gemma-e2e scenario COMMAND"],
    [["scenario", "list", "--help"], "Usage: gemma-e2e scenario list"],
    [["scenario", "get", "--help"], "Usage: gemma-e2e scenario get"],
    [["scenario", "apply", "--help"], "Usage: gemma-e2e scenario apply"],
    [["scenario", "delete", "--help"], "Usage: gemma-e2e scenario delete"],
    [["run", "--help"], "Usage: gemma-e2e run COMMAND"],
    [["run", "start", "--help"], "Usage: gemma-e2e run start"],
    [["run", "list", "--help"], "Usage: gemma-e2e run list"],
    [["run", "get", "--help"], "Usage: gemma-e2e run get"],
    [["run", "watch", "--help"], "Usage: gemma-e2e run watch"],
    [["models", "--help"], "Usage: gemma-e2e models"],
    [["device", "--help"], "Usage: gemma-e2e device"],
  ];

  test("answers --help from the --server flag at every nesting level", async () => {
    for (const server of UNUSABLE) {
      for (const [argv, usage] of helpPaths) {
        const session = await cli([`--server=${server}`, ...argv]);

        expect(session.code).toBe(0);
        expect(session.out).toContain(usage);
        expect(session.err).toBe("");
      }
    }
  });

  test("answers --help from GEMMA_E2E_SERVER at every nesting level", async () => {
    for (const [argv, usage] of helpPaths) {
      const session = await cli(argv, { GEMMA_E2E_SERVER: "not-a-url" });

      expect(session.code).toBe(0);
      expect(session.out).toContain(usage);
      expect(session.err).toBe("");
    }
  });

  test("answers --help when the flag trails the operands", async () => {
    const session = await cli(["run", "get", "run-1", "--server=not-a-url", "--help"]);

    expect(session.code).toBe(0);
    expect(session.out).toContain("Usage: gemma-e2e run get");
    expect(session.err).toBe("");
  });

  const versionPaths = [
    ["--version"],
    ["scenario", "--version"],
    ["scenario", "apply", "--version"],
    ["run", "--version"],
    ["run", "get", "--version"],
    ["run", "start", "--version"],
    ["models", "--version"],
    ["device", "--version"],
    ["-V"],
  ];

  test("answers --version at every nesting level", async () => {
    for (const argv of versionPaths) {
      const session = await cli(["--server=not-a-url", ...argv]);

      expect(session.code).toBe(0);
      expect(session.out.split("\n")[0]).toBe(`${PROGRAM} ${VERSION}`);
      expect(session.err).toBe("");
    }
  });

  // The counterpart to the above: deferring the check must not disarm it. A
  // command that does address the server still refuses to run, and says the
  // value is wrong rather than blaming a dashboard that was never contacted.
  test("still refuses a command that would reach the server", async () => {
    const reaching: string[][] = [
      ["run", "list"],
      ["run", "get", "run-1"],
      ["run", "watch", "run-1"],
      ["run", "start", "--prompt", "hello"],
      ["scenario", "list"],
      ["scenario", "get", "s-1"],
      ["models"],
      ["device"],
    ];

    // Every unusable value, not just the unparseable one: `--server=` and a
    // scheme fetch cannot address are refused by different branches of
    // resolveServer, and testing one of them leaves the others free to regress
    // into a connection error against an address that was never viable.
    for (const server of UNUSABLE) {
      for (const argv of reaching) {
        const session = await cli([`--server=${server}`, ...argv]);

        expect(session.code).toBe(2);
        expect(session.out).toBe("");
        expect(session.err).toContain(
          `invalid --server value ${JSON.stringify(server)}: not a URL`,
        );
        expect(session.err).not.toContain("just web");
        // --server is global, so a hint at the subcommand's help would misdirect.
        expect(session.err).not.toContain("--help");
      }
    }
  });

  test("still refuses an unusable GEMMA_E2E_SERVER on a reaching command", async () => {
    const session = await cli(["run", "list"], { GEMMA_E2E_SERVER: "not-a-url" });

    expect(session.code).toBe(2);
    expect(session.err).toContain("not a URL");
  });

  /**
   * `scenario apply` catches per-file failures so a bad file does not hide the
   * rest, and the server setting is not one of those: it is one mistake about
   * the invocation, so it is reported once, prefixed like every other command's
   * failure -- not repeated bare, once per file.
   */
  describe("scenario apply over an unusable server", () => {
    let dir: string;
    let files: string[];

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), "gemma-cli-apply-server-"));
      const bodies = [
        ["title: Login", "cases:", "  - id: valid", "    prompt: log in"].join("\n"),
        ["title: Shop", "cases:", "  - id: buy", "    prompt: buy a thing"].join("\n"),
      ];
      files = await Promise.all(
        ["login.yaml", "shop.yaml"].map(async (name, index) => {
          const path = join(dir, name);
          await writeFile(path, bodies[index] ?? "", "utf8");
          return path;
        }),
      );
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    test("reports an invalid --server once, with the program prefix", async () => {
      const session = await cli(["--server=not-a-url", "scenario", "apply", ...files]);

      expect(session.code).toBe(2);
      const lines = session.err.split("\n").filter((line) => line !== "");
      expect(lines).toEqual([
        `${PROGRAM}: invalid --server value "not-a-url": not a URL. ` +
          "Give an absolute URL with a scheme, e.g. `--server=http://127.0.0.1:5175`.",
      ]);
    });

    test("reports an unreachable server once, with the program prefix", async () => {
      const session = await cli(["scenario", "apply", ...files]);

      expect(session.code).toBe(2);
      const lines = session.err.split("\n").filter((line) => line !== "");
      expect(lines.length).toBe(1);
      expect(lines[0]).toContain(`${PROGRAM}: cannot reach the server at http://127.0.0.1:1`);
    });
  });
});

describe("usage errors", () => {
  test("reports a missing command on stderr with the help hint and exits 2", async () => {
    const session = await cli([]);

    expect(session.code).toBe(2);
    expect(session.out).toBe("");
    expect(session.err).toBe(
      [`${PROGRAM}: missing command`, `Try '${PROGRAM} --help' for more information.`].join("\n"),
    );
  });

  test("points the hint at the subcommand whose usage was wrong", async () => {
    const session = await cli(["run", "bogus"]);

    expect(session.code).toBe(2);
    expect(session.err).toContain(`Try '${PROGRAM} run --help' for more information.`);
  });

  test("rejects an unknown command", async () => {
    const session = await cli(["bogus"]);

    expect(session.code).toBe(2);
    expect(session.err).toContain("unknown command 'bogus'");
  });

  test("rejects an unknown option against the command that received it", async () => {
    const session = await cli(["run", "list", "--bogus"]);

    expect(session.code).toBe(2);
    expect(session.err).toContain(`Try '${PROGRAM} run list --help' for more information.`);
  });

  test("rejects an extra operand", async () => {
    const session = await cli(["run", "list", "extra"]);

    expect(session.code).toBe(2);
    expect(session.err).toContain("unexpected argument 'extra'");
  });
});

describe("connection failures", () => {
  test("names the server and points at `just web`, exiting 2", async () => {
    const session = await cli(["run", "list"]);

    expect(session.code).toBe(2);
    expect(session.err).toContain(`${PROGRAM}: cannot reach the server at http://127.0.0.1:1`);
    expect(session.err).toContain("just web");
  });

  test("uses the --server flag over GEMMA_E2E_SERVER", async () => {
    const session = await cli(["--server=http://127.0.0.1:2", "run", "list"]);

    expect(session.err).toContain("http://127.0.0.1:2");
  });

  test("accepts --server URL as a separate argument too", async () => {
    const session = await cli(["run", "list", "--server", "http://127.0.0.1:3"]);

    expect(session.err).toContain("http://127.0.0.1:3");
  });

  // Asserted on the resolver rather than by running the command: a developer
  // machine may well have the dashboard listening on the default port, and a
  // test that only passes when it is down is not a test.
  test("falls back to the default port when nothing names a server", () => {
    expect(resolveServer(undefined, {})).toBe(DEFAULT_SERVER);
    expect(DEFAULT_SERVER).toBe("http://127.0.0.1:5175");
  });
});

describe("operand ordering", () => {
  test("accepts global options before the command, between it and the operand, and after", async () => {
    const orderings = [
      ["--server=http://127.0.0.1:4", "run", "get", "run-1"],
      ["run", "--server=http://127.0.0.1:4", "get", "run-1"],
      ["run", "get", "--server=http://127.0.0.1:4", "run-1"],
      ["run", "get", "run-1", "--server=http://127.0.0.1:4"],
    ];

    for (const argv of orderings) {
      const session = await cli(argv);

      expect(session.code).toBe(2);
      expect(session.err).toContain("http://127.0.0.1:4");
    }
  });

  test("treats an operand after -- as a value, not as --version or --help", async () => {
    for (const flag of ["--version", "--help"]) {
      const session = await cli(["run", "get", "--", flag]);

      expect(session.code).toBe(2);
      expect(session.err).toContain("cannot reach the server");
      expect(session.out).toBe("");
    }
  });

  test("treats a flag's own value as a value, not as --version", async () => {
    const session = await cli(["run", "start", "--prompt=--version"]);

    expect(session.out).not.toContain(VERSION);
    expect(session.err).toContain("cannot reach the server");
  });

  test("refuses a dash-leading option value rather than guessing at it", async () => {
    const session = await cli(["run", "start", "--prompt", "--version"]);

    expect(session.code).toBe(2);
    expect(session.out).toBe("");
    expect(session.err).toContain("--prompt=");
  });

  test("treats everything after -- as an operand", async () => {
    // Without the terminator this would be parsed as an unknown option; with
    // it, the CLI gets as far as trying to fetch a run whose id is "--weird".
    const session = await cli(["run", "get", "--", "--weird"]);

    expect(session.code).toBe(2);
    expect(session.err).toContain("cannot reach the server");
  });
});
