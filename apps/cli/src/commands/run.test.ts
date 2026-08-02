import { describe, expect, test } from "bun:test";
import type { Run, RunStatus } from "@gemma-e2e/core/schema";
import type { ExitCode } from "../exit-codes.ts";
import { runCommand, type RunTiming } from "./run.ts";
import { captureContext, sseFrame, sseResponse, withServer } from "../testing.ts";
import { UsageError } from "../usage.ts";

/** Sleeps return immediately, so retry and poll loops run at full speed. */
const FAST: RunTiming = {
  appearDelayMs: 0,
  pollIntervalMs: 0,
  sleep: () => Promise.resolve(),
};

function runDoc(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    scenarioId: "login",
    title: "Login",
    status: "passed",
    verdictReason: null,
    startedAt: "2026-08-02T10:00:00.000Z",
    finishedAt: "2026-08-02T10:01:00.000Z",
    cases: [],
    ...overrides,
  };
}

describe("run get", () => {
  test("exits 0 for a passed run, 1 for a failed one, and 2 for an errored one", async () => {
    const cases: [RunStatus, ExitCode][] = [
      ["passed", 0],
      ["failed", 1],
      ["error", 2],
      ["running", 2],
    ];

    for (const [status, expected] of cases) {
      await withServer(
        () => Response.json({ run: runDoc({ status }) }),
        async (client) => {
          const { context } = captureContext(client);

          expect(await runCommand(["run-1"], context, "get", FAST)).toBe(expected);
        },
      );
    }
  });

  test("prints the run as JSON when --json is given", async () => {
    await withServer(
      () => Response.json({ run: runDoc() }),
      async (client) => {
        const { context, out } = captureContext(client, { json: true });

        await runCommand(["run-1", "--json"], context, "get", FAST);

        expect(JSON.parse(out[0] ?? "")).toMatchObject({ id: "run-1", status: "passed" });
      },
    );
  });
});

describe("run list", () => {
  test("lists the runs the server reports", async () => {
    await withServer(
      () => Response.json({ runs: [runDoc()] }),
      async (client) => {
        const { context, out } = captureContext(client);

        expect(await runCommand([], context, "list", FAST)).toBe(0);
        expect(out.join("\n")).toContain("run-1");
      },
    );
  });
});

describe("run start", () => {
  test("prints the new run id and returns without waiting when --watch is absent", async () => {
    await withServer(
      () => Response.json({ runId: "run-9" }, { status: 202 }),
      async (client) => {
        const { context, out } = captureContext(client);

        expect(await runCommand(["login"], context, "start", FAST)).toBe(0);
        expect(out).toEqual(["run-9"]);
      },
    );
  });

  test("sends the scenario id it was given", async () => {
    let body: unknown = null;
    await withServer(
      async (request) => {
        body = await request.json();
        return Response.json({ runId: "run-9" }, { status: 202 });
      },
      async (client) => {
        const { context } = captureContext(client);

        await runCommand(["login"], context, "start", FAST);

        expect(body).toEqual({ scenarioId: "login" });
      },
    );
  });

  test("sends an ad-hoc prompt with its title and model", async () => {
    let body: unknown = null;
    await withServer(
      async (request) => {
        body = await request.json();
        return Response.json({ runId: "run-9" }, { status: 202 });
      },
      async (client) => {
        const { context } = captureContext(client);

        await runCommand(
          ["--prompt", "buy a coffee", "--title", "Coffee", "--model", "gemma"],
          context,
          "start",
          FAST,
        );

        expect(body).toEqual({ prompt: "buy a coffee", title: "Coffee", model: "gemma" });
      },
    );
  });

  test("accepts the scenario id before or after its flags", async () => {
    await withServer(
      () => Response.json({ runId: "run-9" }, { status: 202 }),
      async (client) => {
        const { context, out } = captureContext(client);

        await runCommand(["--json", "login"], context, "start", FAST);
        await runCommand(["login", "--json"], context, "start", FAST);

        expect(out).toEqual([out[0] as string, out[0] as string]);
      },
    );
  });

  test("refuses a start with neither a scenario id nor a prompt", async () => {
    await withServer(
      () => Response.json({ runId: "run-9" }, { status: 202 }),
      async (client) => {
        const { context } = captureContext(client);

        expect(runCommand([], context, "start", FAST)).rejects.toBeInstanceOf(UsageError);
      },
    );
  });

  test("refuses a start that gives both a scenario id and a prompt", async () => {
    await withServer(
      () => Response.json({ runId: "run-9" }, { status: 202 }),
      async (client) => {
        const { context } = captureContext(client);

        expect(
          runCommand(["login", "--prompt", "buy a coffee"], context, "start", FAST),
        ).rejects.toBeInstanceOf(UsageError);
      },
    );
  });
});

describe("run watch", () => {
  test("retries while the run has not been written yet, then follows it", async () => {
    let lookups = 0;
    await withServer(
      (request) => {
        const isEvents = new URL(request.url).pathname.endsWith("/events");
        if (isEvents) {
          return sseResponse([
            sseFrame("run_finished", {
              type: "run_finished",
              runId: "run-1",
              status: "passed",
              reason: null,
            }),
          ]);
        }
        lookups += 1;
        // 202 answers before the run document exists, so the first few
        // lookups legitimately miss.
        const isReady = lookups > 3;
        return isReady
          ? Response.json({ run: runDoc() })
          : Response.json({ error: "no such run" }, { status: 404 });
      },
      async (client) => {
        const { context } = captureContext(client);

        expect(await runCommand(["run-1"], context, "watch", FAST)).toBe(0);
        expect(lookups).toBe(4);
      },
    );
  });

  test("gives up on a run that never appears", async () => {
    await withServer(
      () => Response.json({ error: "no such run" }, { status: 404 }),
      async (client) => {
        const { context } = captureContext(client);

        expect(runCommand(["ghost"], context, "watch", FAST)).rejects.toThrow("no such run");
      },
    );
  });

  test("prints the timeline and exits with the run's verdict", async () => {
    await withServer(
      (request) => {
        const isEvents = new URL(request.url).pathname.endsWith("/events");
        if (!isEvents) {
          return Response.json({ run: runDoc({ status: "running" }) });
        }
        return sseResponse([
          sseFrame("case_started", {
            type: "case_started",
            runId: "run-1",
            caseId: "valid",
            caseRun: { title: "Logs in" },
          }),
          sseFrame("action_decided", {
            type: "action_decided",
            runId: "run-1",
            caseId: "valid",
            index: 0,
            action: { type: "tap", ref: 3 },
            llmDurationMs: 500,
          }),
          sseFrame("run_finished", {
            type: "run_finished",
            runId: "run-1",
            status: "failed",
            reason: "no login button",
          }),
        ]);
      },
      async (client) => {
        const { context, out } = captureContext(client);

        expect(await runCommand(["run-1"], context, "watch", FAST)).toBe(1);
        expect(out.join("\n")).toContain("case  valid  Logs in");
        expect(out.join("\n")).toContain("tap [3] (500ms)");
        expect(out.join("\n")).toContain("failed  run run-1  no login button");
      },
    );
  });

  test("suppresses the UI dumps that would flood the terminal", async () => {
    await withServer(
      (request) => {
        const isEvents = new URL(request.url).pathname.endsWith("/events");
        if (!isEvents) {
          return Response.json({ run: runDoc({ status: "running" }) });
        }
        return sseResponse([
          sseFrame("ui_captured", {
            type: "ui_captured",
            runId: "run-1",
            caseId: "valid",
            index: 0,
            uiText: "<a very large tree>",
          }),
          sseFrame("run_finished", {
            type: "run_finished",
            runId: "run-1",
            status: "passed",
            reason: null,
          }),
        ]);
      },
      async (client) => {
        const { context, out } = captureContext(client);

        await runCommand(["run-1"], context, "watch", FAST);

        expect(out.join("\n")).not.toContain("a very large tree");
      },
    );
  });

  test("emits one JSON document per event when --json is given", async () => {
    await withServer(
      (request) => {
        const isEvents = new URL(request.url).pathname.endsWith("/events");
        if (!isEvents) {
          return Response.json({ run: runDoc({ status: "running" }) });
        }
        return sseResponse([
          sseFrame("ui_captured", { type: "ui_captured", runId: "run-1", uiText: "tree" }),
          sseFrame("run_finished", {
            type: "run_finished",
            runId: "run-1",
            status: "passed",
            reason: null,
          }),
        ]);
      },
      async (client) => {
        const { context, out } = captureContext(client, { json: true });

        await runCommand(["run-1"], context, "watch", FAST);

        // Every event is machine-readable output, including the ones the
        // human-facing renderer suppresses.
        expect(out.map((line) => JSON.parse(line).type)).toEqual(["ui_captured", "run_finished"]);
      },
    );
  });

  test("falls back to polling when the stream ends without a verdict", async () => {
    let polls = 0;
    await withServer(
      (request) => {
        const isEvents = new URL(request.url).pathname.endsWith("/events");
        if (isEvents) {
          // Closes after a case, never sending run_finished -- what a server
          // restart mid-run looks like to the client.
          return sseResponse([
            sseFrame("case_started", {
              type: "case_started",
              runId: "run-1",
              caseId: "valid",
              caseRun: { title: "Logs in" },
            }),
          ]);
        }
        polls += 1;
        const isOver = polls > 2;
        return Response.json({
          run: runDoc(
            isOver ? { status: "failed", verdictReason: "timed out" } : { status: "running" },
          ),
        });
      },
      async (client) => {
        const { context, out } = captureContext(client);

        expect(await runCommand(["run-1"], context, "watch", FAST)).toBe(1);
        expect(out.join("\n")).toContain("failed  run run-1  timed out");
      },
    );
  });
});

describe("run", () => {
  test("rejects an unknown subcommand and a missing one", () => {
    const { context } = captureContext(undefined as never);

    expect(runCommand([], context, "bogus", FAST)).rejects.toBeInstanceOf(UsageError);
    expect(runCommand([], context, null, FAST)).rejects.toBeInstanceOf(UsageError);
  });

  test("answers --help for a subcommand without contacting the server", async () => {
    const { context } = captureContext(undefined as never);

    const error = await runCommand(["--help"], context, "start", FAST).catch((e: unknown) => e);

    expect((error as { output: string }).output).toContain("Usage: gemma-e2e run start");
  });
});
