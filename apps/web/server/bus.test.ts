import { describe, expect, test } from "bun:test";
import type { RunEvent } from "@gemma-e2e/agent";
import { RunEventBus } from "./bus.ts";

function started(runId: string): RunEvent {
  return { type: "step_started", runId, index: 0 };
}

function finished(runId: string): RunEvent {
  return { type: "run_finished", runId, status: "passed", reason: "done" };
}

describe("RunEventBus", () => {
  test("delivers events only to subscribers of that run", () => {
    const bus = new RunEventBus();
    const a: RunEvent[] = [];
    const b: RunEvent[] = [];

    bus.subscribe("run-a", (e) => a.push(e));
    bus.subscribe("run-b", (e) => b.push(e));
    bus.publish(started("run-a"));

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(0);
  });

  test("stops delivering after unsubscribe", () => {
    const bus = new RunEventBus();
    const seen: RunEvent[] = [];

    const unsubscribe = bus.subscribe("run-a", (e) => seen.push(e));
    bus.publish(started("run-a"));
    unsubscribe();
    bus.publish(started("run-a"));

    expect(seen).toHaveLength(1);
    expect(bus.listenerCount("run-a")).toBe(0);
  });

  test("remembers that a run finished so a late subscriber does not hang", () => {
    const bus = new RunEventBus();

    expect(bus.hasFinished("run-a")).toBe(false);
    bus.publish(finished("run-a"));

    expect(bus.hasFinished("run-a")).toBe(true);
  });

  test("publishing with no subscribers is a no-op", () => {
    const bus = new RunEventBus();

    expect(() => bus.publish(started("run-a"))).not.toThrow();
  });
});
