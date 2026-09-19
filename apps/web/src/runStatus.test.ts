import { describe, expect, test } from "bun:test";
import { nextRunStatus } from "./runStatus.ts";

/**
 * Only the decision is tested here, not the page: rendering React needs a DOM
 * and a testing library this app does not carry, and what a reader has to trust
 * is the rule -- that a run whose turn has come stops saying it is waiting.
 */
describe("nextRunStatus", () => {
  test("promotes a queued run to running when the queue announces it has started", () => {
    expect(nextRunStatus("queued", { type: "run_started" })).toBe("running");
  });

  test("promotes a queued run to running on the first case, for a page attached after run_started", () => {
    // The failure this guards: run_started is published once and does not
    // replay, so a page opened mid-run only ever sees case_started. Without
    // this the pane shows "Waiting for the device" while cases and steps stream
    // in beneath it, and the progress bar and live screen never appear.
    expect(nextRunStatus("queued", { type: "case_started" })).toBe("running");
  });

  test("leaves a finished run alone while its timeline replays, so a verdict is not reopened", () => {
    expect(nextRunStatus("passed", { type: "case_started" })).toBeNull();
    expect(nextRunStatus("failed", { type: "run_started" })).toBeNull();
  });

  test("leaves a run that is already running alone, so no render is scheduled for nothing", () => {
    expect(nextRunStatus("running", { type: "case_started" })).toBeNull();
  });

  test("adopts the verdict the terminal event carries, whatever the run was showing", () => {
    expect(nextRunStatus("queued", { type: "run_finished", status: "failed" })).toBe("failed");
    expect(nextRunStatus("running", { type: "run_finished", status: "passed" })).toBe("passed");
  });

  test("keeps the current status for events that say nothing about progress", () => {
    expect(nextRunStatus("queued", { type: "step_recorded" })).toBeNull();
    expect(nextRunStatus("queued", { type: "case_finished" })).toBeNull();
  });

  test("keeps a status of null until the first fetch supplies one", () => {
    // The stream can outrun the fetch. Inventing "running" here would make the
    // page render a run it has not loaded a title or scenario id for.
    expect(nextRunStatus(null, { type: "case_started" })).toBeNull();
  });
});
