import { describe, expect, test } from "bun:test";
import type { Run, RunStatus, Step } from "@gemma-e2e/core/schema";
import type { ExitCode } from "../exit-codes.ts";
import { runCommand, type RunTiming } from "./run.ts";
import { captureContext, rejection, sseFrame, sseResponse, withServer } from "../testing.ts";
import { UsageError } from "../usage.ts";

/** Sleeps return immediately, so retry and poll loops run at full speed. */
const FAST: RunTiming = {
  appearDelayMs: 0,
  pollIntervalMs: 0,
  sleep: () => Promise.resolve(),
};

/** How many times `watch` looks for a run before giving up, per RUN_APPEAR_ATTEMPTS. */
const WATCH_APPEAR_LOOKUPS = 20;

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

function stepDoc(overrides: Partial<Step> = {}): Step {
  return {
    runId: "run-1",
    caseId: "valid",
    index: 0,
    action: { type: "tap", ref: 0 },
    uiText: "",
    screenshotPath: null,
    note: null,
    createdAt: "2026-08-02T10:00:30.000Z",
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

  test("retries the 404 a run start has not finished writing yet", async () => {
    let lookups = 0;
    await withServer(
      () => {
        lookups += 1;
        // POST /api/runs answers 202 before the document exists, so a get
        // issued right after it legitimately misses at first.
        const isReady = lookups > 2;
        return isReady
          ? Response.json({ run: runDoc() })
          : Response.json({ error: "no such run" }, { status: 404 });
      },
      async (client) => {
        const { context, out } = captureContext(client);

        expect(await runCommand(["run-1"], context, "get", FAST)).toBe(0);
        expect(out.join("\n")).toContain("run-1");
      },
    );
  });

  test("gives up on a missing run far sooner than watch does, so a typo does not hang", async () => {
    let lookups = 0;
    await withServer(
      () => {
        lookups += 1;
        return Response.json({ error: "no such run" }, { status: 404 });
      },
      async (client) => {
        const { context } = captureContext(client);

        await expect(runCommand(["typo"], context, "get", FAST)).rejects.toThrow("no such run");
        expect(lookups).toBeLessThan(WATCH_APPEAR_LOOKUPS);
      },
    );
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

        await expect(runCommand([], context, "start", FAST)).rejects.toBeInstanceOf(UsageError);
      },
    );
  });

  test("refuses a start that gives both a scenario id and a prompt", async () => {
    await withServer(
      () => Response.json({ runId: "run-9" }, { status: 202 }),
      async (client) => {
        const { context } = captureContext(client);

        await expect(
          runCommand(["login", "--prompt", "buy a coffee"], context, "start", FAST),
        ).rejects.toBeInstanceOf(UsageError);
      },
    );
  });

  test("refuses an empty --prompt instead of starting a run without one", async () => {
    let posted = false;
    await withServer(
      () => {
        posted = true;
        return Response.json({ runId: "run-9" }, { status: 202 });
      },
      async (client) => {
        const { context } = captureContext(client);

        const error = await rejection(runCommand(["--prompt", ""], context, "start", FAST));

        expect(error).toBeInstanceOf(UsageError);
        expect(error.message).toContain("--prompt cannot be empty");
        expect(posted).toBe(false);
      },
    );
  });

  test("treats an empty --prompt as a prompt for the conflict check, not as its absence", async () => {
    let posted = false;
    await withServer(
      () => {
        posted = true;
        return Response.json({ runId: "run-9" }, { status: 202 });
      },
      async (client) => {
        const { context } = captureContext(client);

        // The bug this pins: `--prompt ""` used to read as "no prompt", so the
        // scenario id took over and a run started under a flag the user had
        // typed but never got.
        const error = await rejection(
          runCommand(["login", "--prompt", ""], context, "start", FAST),
        );

        expect(error).toBeInstanceOf(UsageError);
        expect(error.message).toContain("not both");
        expect(posted).toBe(false);
      },
    );
  });

  test("refuses --title and --model on a scenario start instead of dropping them", async () => {
    const cases: [string[], string][] = [
      [["login", "--title", "Mine"], "--title"],
      [["login", "--model", "bogus"], "--model"],
      [["login", "--title", "Mine", "--model", "bogus"], "--title and --model"],
    ];

    for (const [argv, named] of cases) {
      let posted = false;
      await withServer(
        () => {
          posted = true;
          return Response.json({ runId: "run-9" }, { status: 202 });
        },
        async (client) => {
          const { context } = captureContext(client);

          const error = await rejection(runCommand(argv, context, "start", FAST));

          expect(error).toBeInstanceOf(UsageError);
          expect(error.message).toContain(named);
          // The server would have ignored these on the scenario branch, so the
          // run must not have been started at all.
          expect(posted).toBe(false);
        },
      );
    }
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
    let lookups = 0;
    await withServer(
      () => {
        lookups += 1;
        return Response.json({ error: "no such run" }, { status: 404 });
      },
      async (client) => {
        const { context } = captureContext(client);

        await expect(runCommand(["ghost"], context, "watch", FAST)).rejects.toThrow("no such run");
        expect(lookups).toBe(WATCH_APPEAR_LOOKUPS);
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
          sseFrame("step_recorded", {
            type: "step_recorded",
            runId: "run-1",
            caseId: "valid",
            step: stepDoc({ index: 0, action: { type: "tap", ref: 3 } }),
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
        expect(out.join("\n")).toContain("  0  tap [3]");
        expect(out.join("\n")).toContain("failed  run run-1  no login button");
      },
    );
  });

  test("prints every step of a finished run, whose timeline replays as step_recorded alone", async () => {
    await withServer(
      (request) => {
        const isEvents = new URL(request.url).pathname.endsWith("/events");
        if (!isEvents) {
          return Response.json({ run: runDoc({ status: "failed" }) });
        }
        // What apps/web/server/app.ts replays for a run that is already over:
        // stored steps arrive as step_recorded, and action_decided -- which
        // only ever exists live -- is nowhere in the stream.
        return sseResponse([
          sseFrame("case_started", {
            type: "case_started",
            runId: "run-1",
            caseId: "valid",
            caseRun: { title: "Logs in" },
          }),
          sseFrame("step_recorded", {
            type: "step_recorded",
            runId: "run-1",
            caseId: "valid",
            step: stepDoc({ index: 0, action: { type: "input_text", ref: 1, text: "demo" } }),
          }),
          sseFrame("step_recorded", {
            type: "step_recorded",
            runId: "run-1",
            caseId: "valid",
            step: stepDoc({ index: 1, action: { type: "tap", ref: 2 } }),
          }),
          sseFrame("run_finished", {
            type: "run_finished",
            runId: "run-1",
            status: "failed",
            reason: "the login failed",
          }),
        ]);
      },
      async (client) => {
        const { context, out } = captureContext(client);

        expect(await runCommand(["run-1"], context, "watch", FAST)).toBe(1);
        const lines = out.join("\n");
        expect(lines).toContain('  0  input_text [1] "demo"');
        expect(lines).toContain("  1  tap [2]");
      },
    );
  });

  test("prints a live step once even though action_decided and step_recorded both arrive", async () => {
    await withServer(
      (request) => {
        const isEvents = new URL(request.url).pathname.endsWith("/events");
        if (!isEvents) {
          return Response.json({ run: runDoc({ status: "running" }) });
        }
        // The order packages/agent/src/run.ts emits for one live step: the
        // decision, then the record of it. Both describe the same action, so
        // exactly one line may reach the terminal.
        return sseResponse([
          sseFrame("action_decided", {
            type: "action_decided",
            runId: "run-1",
            caseId: "valid",
            index: 0,
            action: { type: "tap", ref: 3 },
            llmDurationMs: 500,
          }),
          sseFrame("step_recorded", {
            type: "step_recorded",
            runId: "run-1",
            caseId: "valid",
            step: stepDoc({ index: 0, action: { type: "tap", ref: 3 } }),
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

        const stepLines = out.filter((line) => line.includes("tap [3]"));
        expect(stepLines).toEqual(["    0  tap [3]"]);
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

  test("stops polling a run wedged in running and reports it as unresolved", async () => {
    let polls = 0;
    await withServer(
      (request) => {
        const isEvents = new URL(request.url).pathname.endsWith("/events");
        if (isEvents) {
          // Drops without a verdict, and the run never leaves "running" --
          // an executor killed before it could write one.
          return sseResponse([]);
        }
        polls += 1;
        return Response.json({ run: runDoc({ status: "running" }) });
      },
      async (client) => {
        const { context, err } = captureContext(client);

        expect(await runCommand(["run-1"], context, "watch", FAST)).toBe(2);
        expect(err.join("\n")).toContain("gave up waiting for a verdict");
        // Bounded rather than endless: the exact ceiling is a tuning choice,
        // that it exists at all is the guarantee.
        expect(polls).toBeGreaterThan(1);
        expect(polls).toBeLessThan(10_000);
      },
    );
  });
});

describe("run", () => {
  test("rejects an unknown subcommand and a missing one", async () => {
    const { context } = captureContext(undefined as never);

    await expect(runCommand([], context, "bogus", FAST)).rejects.toBeInstanceOf(UsageError);
    await expect(runCommand([], context, null, FAST)).rejects.toBeInstanceOf(UsageError);
  });

  test("answers --help for a subcommand without contacting the server", async () => {
    const { context } = captureContext(undefined as never);

    const error = await runCommand(["--help"], context, "start", FAST).catch((e: unknown) => e);

    expect((error as { output: string }).output).toContain("Usage: gemma-e2e run start");
  });
});
