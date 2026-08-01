import { describe, expect, test } from "bun:test";
import type { RunEvent } from "@gemma-e2e/agent";
import { RunEventBus } from "./bus.ts";

function started(runId: string): RunEvent {
  return { type: "step_started", runId, caseId: "valid", index: 0 };
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

  test("delivers events from every run to a global subscriber", () => {
    const bus = new RunEventBus();
    const seen: RunEvent[] = [];

    bus.subscribeAll((e) => seen.push(e));
    bus.publish(started("run-a"));
    bus.publish(finished("run-b"));

    expect(seen.map((e) => e.runId)).toEqual(["run-a", "run-b"]);
  });

  test("stops delivering to a global subscriber after unsubscribe", () => {
    const bus = new RunEventBus();
    const seen: RunEvent[] = [];

    const unsubscribe = bus.subscribeAll((e) => seen.push(e));
    bus.publish(started("run-a"));
    unsubscribe();
    bus.publish(started("run-a"));

    expect(seen).toHaveLength(1);
  });

  test("delivers to both the run's subscribers and the global ones", () => {
    const bus = new RunEventBus();
    const perRun: RunEvent[] = [];
    const global: RunEvent[] = [];

    bus.subscribe("run-a", (e) => perRun.push(e));
    bus.subscribeAll((e) => global.push(e));
    bus.publish(started("run-a"));

    expect(perRun).toHaveLength(1);
    expect(global).toHaveLength(1);
  });

  test("publishing with no subscribers is a no-op", () => {
    const bus = new RunEventBus();

    expect(() => bus.publish(started("run-a"))).not.toThrow();
  });
});
