import { describe, expect, test } from "bun:test";
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
