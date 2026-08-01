import type { RunEvent } from "@gemma-e2e/agent";

export type BusListener = (event: RunEvent) => void;

/**
 * Fan-out of run events to whoever is watching a run over SSE.
 *
 * Why not persist events: every event that matters is already a row in the
 * store, and a reconnecting client replays those rows before subscribing.
 * The bus only has to bridge the gap between "run is in progress" and "a
 * browser is attached", so in-memory is sufficient and the process restart
 * that would lose it also ends the runs it was tracking.
 */
export class RunEventBus {
  readonly #listeners = new Map<string, Set<BusListener>>();
  readonly #finished = new Set<string>();

  subscribe(runId: string, listener: BusListener): () => void {
    const existing = this.#listeners.get(runId);
    const set = existing ?? new Set<BusListener>();
    if (existing === undefined) {
      this.#listeners.set(runId, set);
    }
    set.add(listener);

    return () => {
      set.delete(listener);
      const isEmpty = set.size === 0;
      if (isEmpty) {
        this.#listeners.delete(runId);
      }
    };
  }

  publish(event: RunEvent): void {
    const isTerminal = event.type === "run_finished";
    if (isTerminal) {
      this.#finished.add(event.runId);
    }

    const listeners = this.#listeners.get(event.runId);
    if (listeners === undefined) {
      return;
    }
    // Snapshot first: a listener may unsubscribe itself on the terminal event,
    // and mutating the set mid-iteration would skip the listener after it.
    const snapshot = Array.from(listeners);
    for (const listener of snapshot) {
      listener(event);
    }
  }

  /** True once `run_finished` was published, so a subscriber can close. */
  hasFinished(runId: string): boolean {
    return this.#finished.has(runId);
  }

  listenerCount(runId: string): number {
    return this.#listeners.get(runId)?.size ?? 0;
  }
}
