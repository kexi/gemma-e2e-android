import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { errorFields, type Logger, noopLogger } from "@gemma-e2e/logger";

/**
 * One case's screen recording, already started. `stop` resolves only once the
 * file is complete, so the caller can hand the path straight to a player.
 */
export interface Recording {
  /** Where the finished video lands, as an absolute path. */
  readonly path: string;
  /** Ends the recording and waits for the container to be finalised. */
  stop(): Promise<void>;
}

/**
 * Starts a screen recording for one case. Injectable so the loop can be tested
 * without a device: a fake records the start/stop order, and a throwing one
 * proves that a broken recorder does not take the case down with it.
 */
export interface Recorder {
  start(input: { runId: string; caseId: string }): Promise<Recording>;
}

export class RecorderError extends Error {
  override readonly name = "RecorderError";
}

export interface ScrcpyRecorderOptions {
  /** Root under which `{runId}/{caseId}.mp4` is written. */
  videoDir: string;
  /** Target device, matching AdbClient's `serial`; scrcpy spells it `-s`. */
  serial?: string | undefined;
  scrcpyPath?: string | undefined;
  adbPath?: string | undefined;
  /** Defaults to a no-op, so constructing a recorder never writes on its own. */
  logger?: Logger | undefined;
  /** Injection seam for tests; production uses Bun.spawn. */
  spawn?: SpawnFn | undefined;
  /**
   * Ends the device-side capture, which is what makes scrcpy exit. Injected so
   * tests need neither a device nor adb.
   */
  stopServer?: (() => Promise<void>) | undefined;
}

/** The slice of a spawned process this recorder drives. */
export interface RecorderProcess {
  readonly exited: Promise<number>;
  kill(signal: NodeJS.Signals): void;
}

export type SpawnFn = (argv: readonly string[]) => RecorderProcess;

const DEFAULT_SCRCPY_PATH = "scrcpy";
const DEFAULT_ADB_PATH = "adb";

/** Long enough for a hung scrcpy to be noticed, short enough not to stall a run. */
const STOP_TIMEOUT_MS = 10_000;

const defaultSpawn: SpawnFn = (argv) => {
  const child = Bun.spawn([...argv], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  return {
    exited: child.exited,
    kill: (signal) => {
      child.kill(signal);
    },
  };
};

/**
 * Records the device screen with `scrcpy --no-playback --record`.
 *
 * Why scrcpy rather than `adb shell screenrecord`: screenrecord caps a clip at
 * three minutes, which a multi-step case routinely exceeds, and it only exists
 * on the device side. Why not `adb emu screenrecord`: that command is emulator
 * only, so a physical device would need a second implementation. scrcpy pulls
 * the H.264 stream over adb and muxes it here, so emulators and real hardware
 * go down one path with no duration limit.
 */
export class ScrcpyRecorder implements Recorder {
  readonly #videoDir: string;
  readonly #serial: string | undefined;
  readonly #scrcpyPath: string;
  readonly #adbPath: string;
  readonly #log: Logger;
  readonly #spawn: SpawnFn;
  readonly #stopServer: (() => Promise<void>) | undefined;

  constructor(options: ScrcpyRecorderOptions) {
    this.#videoDir = options.videoDir;
    this.#serial = options.serial;
    this.#scrcpyPath = options.scrcpyPath ?? DEFAULT_SCRCPY_PATH;
    this.#adbPath = options.adbPath ?? DEFAULT_ADB_PATH;
    this.#log = options.logger ?? noopLogger;
    this.#spawn = options.spawn ?? defaultSpawn;
    this.#stopServer = options.stopServer;
  }

  /** Runs an adb command against the configured device and returns its stdout. */
  async #adb(...args: string[]): Promise<string> {
    const serialFlag = this.#serial === undefined ? [] : ["-s", this.#serial];
    const child = Bun.spawn([this.#adbPath, ...serialFlag, ...args], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    return stdout;
  }

  /** PIDs of the scrcpy servers currently capturing on the device. */
  async #serverPids(): Promise<Set<string>> {
    const listed = await this.#adb("shell", "ps", "-A", "-o", "PID,ARGS").catch(() => "");

    const pids = new Set<string>();
    for (const line of listed.split("\n")) {
      const isServer = line.includes("com.genymobile.scrcpy.Server");
      if (!isServer) {
        continue;
      }
      const pid = line.trim().split(/\s+/)[0];
      const isNumeric = pid !== undefined && /^\d+$/.test(pid);
      if (isNumeric) {
        pids.add(pid);
      }
    }
    return pids;
  }

  /** Servers that appeared after this recording started, so are its own. */
  async #ownPids(preexisting: Set<string>): Promise<Set<string>> {
    const current = await this.#serverPids();
    return new Set([...current].filter((pid) => !preexisting.has(pid)));
  }

  /**
   * Ends this recording's device-side capture. scrcpy sees the stream end and
   * shuts down of its own accord, finalising the MP4 on the way out.
   *
   * Why the PIDs are captured at start rather than matched by name at stop: a
   * name match would also kill the servers belonging to any other recording on
   * the same device, truncating their files. Only the processes this recording
   * brought into existence are fair game.
   */
  async #endCapture(own: Set<string>): Promise<void> {
    const injected = this.#stopServer;
    const hasInjected = injected !== undefined;
    if (hasInjected) {
      await injected();
      return;
    }

    const isEmpty = own.size === 0;
    if (isEmpty) {
      return;
    }

    await this.#adb("shell", "kill", ...own);
  }

  async start(input: { runId: string; caseId: string }): Promise<Recording> {
    const dir = join(this.#videoDir, input.runId);
    await mkdir(dir, { recursive: true });
    // The container is chosen from the extension, and .mp4 gives H.264 in MP4 —
    // the one combination every browser plays without a transcode.
    const path = join(dir, `${input.caseId}.mp4`);

    // Sampled before the spawn so the servers already capturing for someone
    // else can be told apart from the one this recording is about to create.
    const isDelegated = this.#stopServer !== undefined;
    const preexisting = isDelegated ? new Set<string>() : await this.#serverPids();

    const serialFlag = this.#serial === undefined ? [] : ["-s", this.#serial];
    const argv = [
      this.#scrcpyPath,
      ...serialFlag,
      // --no-playback keeps the mirroring window closed: the recording is the
      // artifact, and a window would need a display on a headless CI machine.
      "--no-playback",
      "--record",
      path,
    ];

    const child = this.#spawn(argv);

    // Why not wait for the video socket to be up: scrcpy takes a moment to
    // negotiate it, and polling for the first frame would add that delay to
    // every case for the sake of the first second of footage. The opening
    // moments of a case are the app-reset screen, so losing them costs nothing.
    this.#log.info("record.started", {
      path,
      ...(this.#serial === undefined ? {} : { serial: this.#serial }),
    });

    return {
      path,
      stop: async () => {
        // Why not signal the scrcpy process: scrcpy 4.1 installs its interrupt
        // handling through SDL's event loop, which never runs under
        // --no-playback with no terminal, so both SIGINT and SIGTERM are
        // ignored outright when spawned from a server process. Falling back to
        // SIGKILL is worse than useless — it leaves an MP4 whose `moov` atom
        // was never written, which no player will open.
        //
        // Ending the device-side capture instead reaches scrcpy through the
        // path it does listen on: the video stream closes, scrcpy finalises
        // the container and exits on its own.
        const own = isDelegated ? new Set<string>() : await this.#ownPids(preexisting);
        await this.#endCapture(own);
        await this.#awaitExit(child, path);
      },
    };
  }

  async #awaitExit(child: RecorderProcess, path: string): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), STOP_TIMEOUT_MS);
    });

    try {
      const outcome = await Promise.race([child.exited, timeout]);
      const timedOut = outcome === "timeout";
      if (timedOut) {
        // Killed only to stop it holding the device for the next case. The
        // throw is what matters: a file that scrcpy never finalised has no
        // `moov` atom, so the caller must report no video rather than a path
        // to something unplayable.
        child.kill("SIGKILL");
        throw new RecorderError(`scrcpy did not exit within ${STOP_TIMEOUT_MS}ms: ${path}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

/** What a recorded case produced: the body's outcome, or the error it raised. */
export type RecordedOutcome<T> =
  | { ok: true; result: T; videoPath: string | null }
  | { ok: false; error: unknown; videoPath: string | null };

/**
 * Wraps a recorder so a failure to record never fails the case it belongs to.
 * Reports the video path when recording worked and `null` when it did not, and
 * logs `record.failed` either way so a device that never records is diagnosable.
 *
 * Why the body's error is returned rather than thrown: a case that crashed
 * still has a recording, and it is the one most worth watching. Throwing would
 * force the caller to choose between the error and the path, since only one of
 * the two can come back through a rejection.
 */
export async function recordCase<T>(
  recorder: Recorder | undefined,
  input: { runId: string; caseId: string },
  log: Logger,
  body: () => Promise<T>,
): Promise<RecordedOutcome<T>> {
  let recording: Recording | null = null;

  const isEnabled = recorder !== undefined;
  if (isEnabled) {
    try {
      recording = await recorder.start(input);
    } catch (error) {
      // Best effort: the verdict comes from the step log, and a case that
      // cannot be filmed is still a case worth running.
      log.warn("record.failed", { phase: "start", ...errorFields(error) });
    }
  }

  try {
    const result = await body();
    return { ok: true, result, videoPath: await stopQuietly(recording, log) };
  } catch (error) {
    return { ok: false, error, videoPath: await stopQuietly(recording, log) };
  }
}

async function stopQuietly(recording: Recording | null, log: Logger): Promise<string | null> {
  const isAbsent = recording === null;
  if (isAbsent) {
    return null;
  }

  try {
    await recording.stop();
    log.info("record.stopped", { path: recording.path });
    return recording.path;
  } catch (error) {
    // A recording that could not be finalised has no usable moov atom, so the
    // path is reported as absent rather than pointing at an unplayable file.
    log.warn("record.failed", { phase: "stop", path: recording.path, ...errorFields(error) });
    return null;
  }
}
