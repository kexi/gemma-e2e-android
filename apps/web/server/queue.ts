import type { Scenario } from "@gemma-e2e/core";
import { errorFields, type Logger, noopLogger } from "@gemma-e2e/logger";
import type { RunEvent } from "@gemma-e2e/agent";

/** One accepted run, holding everything needed to start it later, unchanged. */
export interface QueuedJob {
  runId: string;
  scenario: Scenario;
  onEvent: (event: RunEvent) => void;
}

/** Runs a job to completion. Injected so the queue itself needs no device. */
export type ExecuteRun = (job: QueuedJob) => Promise<void>;

export interface RunQueueOptions {
  execute: ExecuteRun;
  /** Defaults to a no-op so the queue tests stay quiet unless they opt in. */
  logger?: Logger | undefined;
}

/**
 * Runs scenarios one at a time, in the order they were accepted.
 *
 * Why serial: the process drives a single adb device and a single CDP browser,
 * so two runs in flight would interleave taps on the same screen and neither
 * verdict would mean anything. It is the same constraint that makes the cases
 * inside one scenario run sequentially (see `runScenario` in
 * `packages/agent/src/run.ts`); a batch of scenarios is the same hardware seen
 * one level up, so it gets the same answer.
 *
 * Why not drive the sequence from `run_finished` on the RunEventBus: the
 * `await this.#execute(next)` below already is the sequencing, and it holds
 * even when nothing is published. An event-driven queue only advances if the
 * terminal event actually arrives, so a `runScenario` that dies before
 * emitting one -- an unhandled throw, a process-level failure in the store --
 * would strand every job behind it forever. `await` in a `try/finally` cannot
 * be skipped that way.
 *
 * Why not persist the pending jobs: the same reasoning as the RunEventBus (see
 * `bus.ts`). A process restart that loses the queue also kills the run it was
 * executing, and a restored job would resume against device state that no
 * longer exists -- an app left mid-flow by the killed run, or a fresh emulator
 * with nothing installed. Under `--watch` a resume would be worse still, since
 * every edit would relaunch the batch.
 *
 * What a restart leaves behind is therefore documents that no process will ever
 * finish, and those are NOT left as they are: `Store.settleOrphanedRuns` closes
 * every `queued` and `running` run out to `error` at startup (wired in
 * `index.ts`). Dropping the jobs and saying nothing would leave the dashboard
 * showing "waiting for the device" and the CLI polling forever for a run whose
 * executor no longer exists -- the queue being in memory is a decision about
 * what to retry, not a licence to lie about what is still coming.
 */
export class RunQueue {
  readonly #pending: QueuedJob[] = [];
  readonly #execute: ExecuteRun;
  readonly #log: Logger;
  #activeRunId: string | null = null;
  #draining = false;

  constructor(options: RunQueueOptions) {
    this.#execute = options.execute;
    this.#log = options.logger ?? noopLogger;
  }

  /**
   * Accepts a job and returns at once, without waiting for it to run. The API
   * answers 202 on this: the run is durable and ordered, but not yet started.
   */
  enqueue(job: QueuedJob): void {
    this.#pending.push(job);
    this.#log.info("queue.enqueued", {
      runId: job.runId,
      scenarioId: job.scenario.id,
      depth: this.depth(),
    });
    void this.#drain();
  }

  /** Jobs still waiting their turn. The active one is not among them. */
  pending(): readonly QueuedJob[] {
    return [...this.#pending];
  }

  activeRunId(): string | null {
    return this.#activeRunId;
  }

  /** Waiting plus running, so a caller can say how far back a new job lands. */
  depth(): number {
    const activeCount = this.#activeRunId === null ? 0 : 1;
    return this.#pending.length + activeCount;
  }

  /**
   * Drops a job that has not started. Returns false for the running one and
   * for an id the queue never had.
   *
   * Why the running job cannot be cancelled: `runScenario` has no cancellation
   * seam -- no AbortSignal reaches `openDriver`, `llm.decide`, or `recordCase`
   * -- so the only way to stop it would be to abandon it mid-step. That leaves
   * the device in a state the next run cannot assume anything about: an app
   * half-navigated, a recording still writing, a CDP target still attached.
   * Refusing is honest; the caller waits, and the next job starts from a
   * force-stopped app as usual.
   */
  cancel(runId: string): boolean {
    const index = this.#pending.findIndex((job) => job.runId === runId);
    const isPending = index !== -1;
    if (!isPending) {
      return false;
    }
    this.#pending.splice(index, 1);
    this.#log.info("queue.cancelled", { runId, depth: this.depth() });
    return true;
  }

  async #drain(): Promise<void> {
    const isAlreadyDraining = this.#draining;
    if (isAlreadyDraining) {
      return;
    }
    this.#draining = true;

    try {
      for (;;) {
        const next = this.#pending.shift();
        const isDrained = next === undefined;
        if (isDrained) {
          return;
        }

        this.#activeRunId = next.runId;
        try {
          await this.#execute(next);
        } catch (error) {
          // Swallowed on purpose: one run's crash must not strand the jobs
          // queued behind it, which are independent scenarios that have
          // nothing to do with what went wrong here. `runScenario` already
          // turns every in-run failure into a finished case with status
          // `error`, so a rejection reaching this far means the store itself
          // is broken -- worth a log line, and nothing the queue can act on.
          this.#log.error("queue.job_failed", {
            runId: next.runId,
            scenarioId: next.scenario.id,
            ...errorFields(error),
          });
        } finally {
          this.#activeRunId = null;
        }
      }
    } finally {
      // Cleared in `finally` rather than after the loop so a throw from the
      // queue's own bookkeeping cannot leave the flag stuck on, which would
      // mean no later `enqueue` ever starts a drain again.
      this.#draining = false;
    }
  }
}
