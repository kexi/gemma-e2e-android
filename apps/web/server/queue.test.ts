import { describe, expect, test } from "bun:test";
import type { Scenario } from "@gemma-e2e/core";
import type { RunEvent } from "@gemma-e2e/agent";
import { type ExecuteRun, type QueuedJob, RunQueue } from "./queue.ts";

function scenario(id: string): Scenario {
  return {
    id,
    title: id,
    tags: [],
    cases: [{ id: "only", title: "only", prompt: "do the thing", maxSteps: 5 }],
  };
}

function job(runId: string, onEvent: (event: RunEvent) => void = () => {}): QueuedJob {
  return { runId, scenario: scenario(`scenario-${runId}`), onEvent };
}

/**
 * A job whose start the test can await and whose end the test decides. Holding
 * a job open is the only way to observe the queue mid-flight, since everything
 * else about it is over within a microtask.
 */
interface Gate {
  /** Resolves once the executor has entered this job. */
  started: Promise<void>;
  markStarted: () => void;
  /** Awaited by the executor; the job ends when the test releases it. */
  wait: Promise<void>;
  release: () => void;
}

function gate(): Gate {
  let release = (): void => {};
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  let markStarted = (): void => {};
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  return { started, markStarted, wait, release };
}

/** Yields long enough for any already-scheduled microtask chain to settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
}

describe("RunQueue", () => {
  test("runs jobs in the order they were enqueued", async () => {
    const order: string[] = [];
    const execute: ExecuteRun = async (accepted) => {
      order.push(accepted.runId);
    };
    const queue = new RunQueue({ execute });

    queue.enqueue(job("run-a"));
    queue.enqueue(job("run-b"));
    queue.enqueue(job("run-c"));
    await settle();

    expect(order).toEqual(["run-a", "run-b", "run-c"]);
  });

  test("never has two jobs in flight, so the single device is never shared", async () => {
    let inFlight = 0;
    let peak = 0;
    const gates = [gate(), gate(), gate()];
    const execute: ExecuteRun = async (accepted) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      const index = Number(accepted.runId.slice(-1));
      const own = gates[index];
      if (own !== undefined) {
        own.markStarted();
        await own.wait;
      }
      inFlight -= 1;
    };
    const queue = new RunQueue({ execute });

    queue.enqueue(job("run-0"));
    queue.enqueue(job("run-1"));
    queue.enqueue(job("run-2"));

    // Each gate opens only after the previous job has actually entered
    // `execute`, so if the queue ever started two at once `peak` would see it.
    for (const each of gates) {
      await each.started;
      each.release();
      await settle();
    }

    expect(peak).toBe(1);
    expect(inFlight).toBe(0);
  });

  test("keeps running the jobs behind one that throws", async () => {
    const completed: string[] = [];
    const execute: ExecuteRun = async (accepted) => {
      const isDoomed = accepted.runId === "run-b";
      if (isDoomed) {
        throw new Error("the store is broken");
      }
      completed.push(accepted.runId);
    };
    const queue = new RunQueue({ execute });

    queue.enqueue(job("run-a"));
    queue.enqueue(job("run-b"));
    queue.enqueue(job("run-c"));
    await settle();

    expect(completed).toEqual(["run-a", "run-c"]);
    expect(queue.depth()).toBe(0);
  });

  test("cancelling a pending job stops it from ever being executed", async () => {
    const executed: string[] = [];
    const first = gate();
    const execute: ExecuteRun = async (accepted) => {
      executed.push(accepted.runId);
      const isFirst = accepted.runId === "run-a";
      if (isFirst) {
        first.markStarted();
        await first.wait;
      }
    };
    const queue = new RunQueue({ execute });

    queue.enqueue(job("run-a"));
    queue.enqueue(job("run-b"));
    queue.enqueue(job("run-c"));
    await first.started;

    expect(queue.cancel("run-b")).toBe(true);
    first.release();
    await settle();

    expect(executed).toEqual(["run-a", "run-c"]);
  });

  test("refuses to cancel the running job, because a run cannot be interrupted", async () => {
    const first = gate();
    const execute: ExecuteRun = async () => {
      first.markStarted();
      await first.wait;
    };
    const queue = new RunQueue({ execute });

    queue.enqueue(job("run-a"));
    await first.started;

    expect(queue.activeRunId()).toBe("run-a");
    expect(queue.cancel("run-a")).toBe(false);

    first.release();
    await settle();
  });

  test("cancelling an id the queue never had reports that nothing was removed", () => {
    const queue = new RunQueue({ execute: async () => {} });

    expect(queue.cancel("run-unknown")).toBe(false);
  });

  test("reports the waiting jobs without the one currently running", async () => {
    const first = gate();
    const execute: ExecuteRun = async () => {
      first.markStarted();
      await first.wait;
    };
    const queue = new RunQueue({ execute });

    queue.enqueue(job("run-a"));
    queue.enqueue(job("run-b"));
    queue.enqueue(job("run-c"));
    await first.started;

    expect(queue.activeRunId()).toBe("run-a");
    expect(queue.pending().map((each) => each.runId)).toEqual(["run-b", "run-c"]);
    // Depth counts the running job too, so it answers "how many runs before
    // this one finishes", not "how many are waiting".
    expect(queue.depth()).toBe(3);

    first.release();
    await settle();

    expect(queue.activeRunId()).toBeNull();
    expect(queue.pending()).toEqual([]);
    expect(queue.depth()).toBe(0);
  });

  test("an idle queue reports nothing active and nothing pending", () => {
    const queue = new RunQueue({ execute: async () => {} });

    expect(queue.activeRunId()).toBeNull();
    expect(queue.pending()).toEqual([]);
    expect(queue.depth()).toBe(0);
  });

  test("accepts a job enqueued while another is running and starts it after", async () => {
    const executed: string[] = [];
    const first = gate();
    const execute: ExecuteRun = async (accepted) => {
      executed.push(accepted.runId);
      const isFirst = accepted.runId === "run-a";
      if (isFirst) {
        first.markStarted();
        await first.wait;
      }
    };
    const queue = new RunQueue({ execute });

    queue.enqueue(job("run-a"));
    await first.started;
    // A second drain must not start here: the guard is what keeps the device
    // to one run even when enqueue arrives mid-flight.
    queue.enqueue(job("run-b"));

    expect(executed).toEqual(["run-a"]);

    first.release();
    await settle();

    expect(executed).toEqual(["run-a", "run-b"]);
  });

  test("hands the job's own onEvent to the executor untouched", async () => {
    const seen: RunEvent[] = [];
    const execute: ExecuteRun = async (accepted) => {
      accepted.onEvent({
        type: "run_finished",
        runId: accepted.runId,
        status: "passed",
        reason: null,
      });
    };
    const queue = new RunQueue({ execute });

    queue.enqueue(job("run-a", (event) => seen.push(event)));
    await settle();

    expect(seen).toEqual([
      { type: "run_finished", runId: "run-a", status: "passed", reason: null },
    ]);
  });
});
