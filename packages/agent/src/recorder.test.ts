import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger, type LogEvent, noopLogger } from "@gemma-e2e/logger";
import { recordCase, RecorderError, ScrcpyRecorder, type SpawnFn } from "./recorder.ts";
import { FakeProcess, FakeRecorder } from "./fakes.ts";

let videoDir: string;

beforeEach(async () => {
  videoDir = await mkdtemp(join(tmpdir(), "gemma-videos-"));
});

afterEach(async () => {
  await rm(videoDir, { recursive: true, force: true });
});

/** Captures NDJSON lines the way a stderr consumer would read them back. */
function capture() {
  const lines: string[] = [];
  return {
    logger: createLogger({ sink: (line) => lines.push(line), level: "debug" }),
    events: () => lines.map((line) => JSON.parse(line) as LogEvent),
  };
}

describe("ScrcpyRecorder", () => {
  /** Records the argv each start used and hands back a controllable process. */
  function spy() {
    const commands: string[][] = [];
    const processes: FakeProcess[] = [];
    const stops: number[] = [];
    const spawn: SpawnFn = (argv) => {
      commands.push([...argv]);
      const child = new FakeProcess();
      processes.push(child);
      return child;
    };
    // Stands in for the adb call that ends the device-side capture; scrcpy
    // exits once the stream it was reading closes.
    const stopServer = async () => {
      stops.push(processes.length);
      for (const child of processes) {
        child.streamClosed();
      }
    };
    return { commands, processes, stops, spawn, stopServer };
  }

  test("records to var/videos/{runId}/{caseId}.mp4", async () => {
    const s = spy();
    const recorder = new ScrcpyRecorder({ videoDir, spawn: s.spawn, stopServer: s.stopServer });

    const recording = await recorder.start({ runId: "run-1", caseId: "logs-in" });

    expect(recording.path).toBe(join(videoDir, "run-1", "logs-in.mp4"));
  });

  test("creates the run's video directory before scrcpy needs it", async () => {
    const s = spy();
    const recorder = new ScrcpyRecorder({ videoDir, spawn: s.spawn, stopServer: s.stopServer });

    await recorder.start({ runId: "run-1", caseId: "logs-in" });

    expect((await stat(join(videoDir, "run-1"))).isDirectory()).toBe(true);
  });

  test("runs scrcpy with --no-playback so no mirroring window opens", async () => {
    const s = spy();
    const recorder = new ScrcpyRecorder({ videoDir, spawn: s.spawn, stopServer: s.stopServer });

    await recorder.start({ runId: "run-1", caseId: "logs-in" });

    expect(s.commands[0]).toEqual([
      "scrcpy",
      "--no-playback",
      "--record",
      join(videoDir, "run-1", "logs-in.mp4"),
    ]);
  });

  test("targets the configured serial, matching the adb client", async () => {
    const s = spy();
    const recorder = new ScrcpyRecorder({
      videoDir,
      serial: "emulator-5554",
      spawn: s.spawn,
      stopServer: s.stopServer,
    });

    await recorder.start({ runId: "run-1", caseId: "logs-in" });

    expect(s.commands[0]?.slice(0, 3)).toEqual(["scrcpy", "-s", "emulator-5554"]);
  });

  test("stops by ending the device capture, never by signalling scrcpy", async () => {
    const s = spy();
    const recorder = new ScrcpyRecorder({ videoDir, spawn: s.spawn, stopServer: s.stopServer });

    const recording = await recorder.start({ runId: "run-1", caseId: "logs-in" });
    await recording.stop();

    expect(s.stops).toHaveLength(1);
    // SIGINT and SIGTERM are ignored by scrcpy under --no-playback, so sending
    // one and trusting it would silently produce an unfinalised file.
    expect(s.processes[0]?.signals).toEqual([]);
  });

  test("stop resolves only after the process has exited", async () => {
    const s = spy();
    // Ends nothing, so `exited` stays pending until the test resolves it.
    const recorder = new ScrcpyRecorder({ videoDir, spawn: s.spawn, stopServer: async () => {} });

    const recording = await recorder.start({ runId: "run-1", caseId: "logs-in" });
    let settled = false;
    const stopping = recording.stop().then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    s.processes[0]?.streamClosed();
    await stopping;
    expect(settled).toBe(true);
  });

  test("reports a failure rather than a path when scrcpy never exits", async () => {
    const s = spy();
    const recorder = new ScrcpyRecorder({
      videoDir,
      spawn: s.spawn,
      // A device that never releases the encoder leaves scrcpy running.
      stopServer: async () => {},
    });

    const recording = await recorder.start({ runId: "run-1", caseId: "logs-in" });
    const stopping = recording.stop();

    await expect(stopping).rejects.toThrow(RecorderError);
    // Killed so it cannot hold the device for the next case.
    expect(s.processes[0]?.signals).toEqual(["SIGKILL"]);
  }, 20_000);

  test("logs record.started with the destination path", async () => {
    const s = spy();
    const log = capture();
    const recorder = new ScrcpyRecorder({ videoDir, spawn: s.spawn, logger: log.logger });

    await recorder.start({ runId: "run-1", caseId: "logs-in" });

    expect(log.events().find((e) => e.event === "record.started")).toMatchObject({
      path: join(videoDir, "run-1", "logs-in.mp4"),
    });
  });

  test("stays silent when no logger is injected", async () => {
    const s = spy();
    const recorder = new ScrcpyRecorder({ videoDir, spawn: s.spawn, logger: noopLogger });

    const recording = await recorder.start({ runId: "run-1", caseId: "logs-in" });

    expect(recording.path).toContain("logs-in.mp4");
  });
});

describe("recordCase", () => {
  test("brackets the body between start and stop", async () => {
    const recorder = new FakeRecorder();
    const order: string[] = [];

    await recordCase(recorder, { runId: "run-1", caseId: "a" }, noopLogger, async () => {
      order.push(...recorder.calls, "body");
    });

    expect(order).toEqual(["start:a", "body"]);
    expect(recorder.calls).toEqual(["start:a", "stop:a"]);
  });

  test("reports the recorded path once the case is over", async () => {
    const recorder = new FakeRecorder();

    const { videoPath } = await recordCase(
      recorder,
      { runId: "run-1", caseId: "a" },
      noopLogger,
      async () => {},
    );

    expect(videoPath).toBe("/videos/run-1/a.mp4");
  });

  test("returns the body's result unchanged", async () => {
    const recorder = new FakeRecorder();

    const outcome = await recordCase(
      recorder,
      { runId: "run-1", caseId: "a" },
      noopLogger,
      async () => "verdict",
    );

    expect(outcome).toMatchObject({ ok: true, result: "verdict" });
  });

  test("runs the body with no path at all when recording is off", async () => {
    let ran = false;

    const { videoPath } = await recordCase(
      undefined,
      { runId: "run-1", caseId: "a" },
      noopLogger,
      async () => {
        ran = true;
      },
    );

    expect(ran).toBe(true);
    expect(videoPath).toBeNull();
  });

  test("still runs the body when the recorder cannot start", async () => {
    const recorder = new FakeRecorder({ start: true });
    let ran = false;

    const { videoPath } = await recordCase(
      recorder,
      { runId: "run-1", caseId: "a" },
      noopLogger,
      async () => {
        ran = true;
      },
    );

    expect(ran).toBe(true);
    expect(videoPath).toBeNull();
  });

  test("reports no path when the recording could not be finalised", async () => {
    const recorder = new FakeRecorder({ stop: true });

    const { videoPath } = await recordCase(
      recorder,
      { runId: "run-1", caseId: "a" },
      noopLogger,
      async () => {},
    );

    expect(videoPath).toBeNull();
  });

  test("stops the recording and reports the failure when the body throws", async () => {
    const recorder = new FakeRecorder();

    const outcome = await recordCase(
      recorder,
      { runId: "run-1", caseId: "a" },
      noopLogger,
      async () => {
        throw new Error("device offline");
      },
    );

    expect(outcome.ok).toBe(false);
    expect((outcome as { error: unknown }).error).toMatchObject({ message: "device offline" });
    expect(recorder.calls).toEqual(["start:a", "stop:a"]);
  });

  test("keeps the recording of a body that failed", async () => {
    const recorder = new FakeRecorder();

    const outcome = await recordCase(
      recorder,
      { runId: "run-1", caseId: "a" },
      noopLogger,
      async () => {
        throw new Error("device offline");
      },
    );

    expect(outcome.videoPath).toBe("/videos/run-1/a.mp4");
  });

  test("reports the body's failure rather than the recorder's", async () => {
    const recorder = new FakeRecorder({ stop: true });

    const outcome = await recordCase(
      recorder,
      { runId: "run-1", caseId: "a" },
      noopLogger,
      async () => {
        throw new Error("device offline");
      },
    );

    expect((outcome as { error: unknown }).error).toMatchObject({ message: "device offline" });
    expect(outcome.videoPath).toBeNull();
  });

  test("warns record.failed with the phase that broke", async () => {
    const log = capture();
    const recorder = new FakeRecorder({ start: true });

    await recordCase(recorder, { runId: "run-1", caseId: "a" }, log.logger, async () => {});

    expect(log.events().find((e) => e.event === "record.failed")).toMatchObject({
      level: "warn",
      phase: "start",
      error: "scrcpy is not installed",
    });
  });

  test("logs record.stopped with the finished file", async () => {
    const log = capture();
    const recorder = new FakeRecorder();

    await recordCase(recorder, { runId: "run-1", caseId: "a" }, log.logger, async () => {});

    expect(log.events().find((e) => e.event === "record.stopped")).toMatchObject({
      level: "info",
      path: "/videos/run-1/a.mp4",
    });
  });
});

describe("RecorderError", () => {
  test("names itself so a log line can be filtered on it", () => {
    expect(new RecorderError("boom").name).toBe("RecorderError");
  });
});
