import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { errorFields, type Logger, noopLogger } from "@gemma-e2e/logger";
import type { Recorder, Recording } from "../recorder.ts";
import { ebmlFrame, ebmlHeader } from "./ebml.ts";

/** One frame of the page, as the screencast encoded it. */
export interface ScreencastFrame {
  data: string;
  timestampMs: number;
}

/** Subscribes to a page's frames and returns the unsubscribe function. */
export type SubscribeFrames = (handler: (frame: ScreencastFrame) => void) => Promise<() => void>;

/** The slice of a spawned ffmpeg this recorder drives. */
export interface FfmpegProcess {
  readonly exited: Promise<number>;
  write(chunk: Uint8Array): void;
  /** Closes stdin, which is what tells ffmpeg the stream has ended. */
  end(): void;
  kill(): void;
}

export type FfmpegSpawn = (argv: readonly string[]) => FfmpegProcess;

export interface CdpRecorderOptions {
  /** Root under which `{runId}/{caseId}.mp4` is written. */
  videoDir: string;
  subscribe: SubscribeFrames;
  /** Frame size, so the container declares one ffmpeg agrees with. */
  width: number;
  height: number;
  ffmpegPath?: string | undefined;
  logger?: Logger | undefined;
  spawn?: FfmpegSpawn | undefined;
}

const DEFAULT_FFMPEG_PATH = "ffmpeg";

/**
 * Output frame rate. The screencast tops out around 30fps and delivers nothing
 * at all while the page is still, so this is the rate frames are *placed* at,
 * not a rate they arrive at.
 */
const OUTPUT_FPS = 25;

/** Long enough for a hung ffmpeg to be noticed, short enough not to stall a run. */
const STOP_TIMEOUT_MS = 10_000;

/** How long the last frame is held, so a case does not end on a blink. */
const TAIL_MS = 1000;

const defaultSpawn: FfmpegSpawn = (argv) => {
  const child = Bun.spawn([...argv], { stdin: "pipe", stdout: "ignore", stderr: "pipe" });
  const stdin = child.stdin;
  return {
    exited: child.exited,
    write: (chunk) => {
      stdin.write(chunk);
    },
    end: () => {
      void stdin.end();
    },
    kill: () => {
      child.kill();
    },
  };
};

/**
 * Records a page by muxing `Page.startScreencast` frames into an MP4.
 *
 * CDP has no video capture; the screencast is the only stream a page offers,
 * and it is JPEG frames over the protocol. Playwright records Chromium the
 * same way -- there is no private path this is missing out on.
 *
 * The result is worse than scrcpy's, which pulls a hardware-encoded H.264
 * stream off the device: this is a lossy JPEG per frame, capped around 30fps,
 * and fast scrolling visibly drops frames. For an artifact that explains what
 * the agent did, that is enough; for a smooth demo it is not.
 */
export class CdpRecorder implements Recorder {
  readonly #videoDir: string;
  readonly #subscribe: SubscribeFrames;
  readonly #width: number;
  readonly #height: number;
  readonly #ffmpegPath: string;
  readonly #log: Logger;
  readonly #spawn: FfmpegSpawn;

  constructor(options: CdpRecorderOptions) {
    this.#videoDir = options.videoDir;
    this.#subscribe = options.subscribe;
    // Rounded to even: most encoders reject odd dimensions outright.
    this.#width = options.width & ~1;
    this.#height = options.height & ~1;
    this.#ffmpegPath = options.ffmpegPath ?? DEFAULT_FFMPEG_PATH;
    this.#log = options.logger ?? noopLogger;
    this.#spawn = options.spawn ?? defaultSpawn;
  }

  async start(input: { runId: string; caseId: string }): Promise<Recording> {
    const dir = join(this.#videoDir, input.runId);
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${input.caseId}.mp4`);

    const ffmpeg = this.#spawn([
      this.#ffmpegPath,
      "-loglevel",
      "error",
      // The input is the Matroska stream written below, which carries its own
      // timestamps; probing it would only delay the first frame.
      "-f",
      "matroska",
      "-probesize",
      "32",
      "-analyzeduration",
      "0",
      "-i",
      "pipe:0",
      "-y",
      "-an",
      // The whole point: a constant output rate over timestamped input, so
      // ffmpeg duplicates frames across the stretches where the page did not
      // change and the recording keeps pace with the run.
      "-r",
      String(OUTPUT_FPS),
      "-c:v",
      "libx264",
      // Without this the file plays in ffmpeg and nowhere else.
      "-pix_fmt",
      "yuv420p",
      "-preset",
      "veryfast",
      path,
    ]);

    ffmpeg.write(ebmlHeader(this.#width, this.#height));

    let firstTimestampMs: number | null = null;
    let lastFrame: Uint8Array | null = null;
    let lastOffsetMs = 0;
    let frameCount = 0;

    const unsubscribe = await this.#subscribe((frame) => {
      const jpeg = Uint8Array.from(atob(frame.data), (character) => character.charCodeAt(0));

      firstTimestampMs ??= frame.timestampMs;
      // Relative to the first frame, so the recording starts at zero however
      // long the browser has been up.
      const offsetMs = Math.max(0, frame.timestampMs - firstTimestampMs);

      lastFrame = jpeg;
      lastOffsetMs = offsetMs;
      frameCount += 1;

      try {
        ffmpeg.write(ebmlFrame(jpeg, offsetMs));
      } catch (error) {
        // A dead ffmpeg must not take the case down with it: the verdict comes
        // from the step log, and the video is a debugging aid.
        this.#log.warn("record.frame_dropped", { ...errorFields(error) });
      }
    });

    this.#log.info("record.started", { path, fps: OUTPUT_FPS });

    return {
      path,
      stop: async () => {
        unsubscribe();

        // Held so the closing screen is readable rather than a single frame
        // flashing past at the end of the clip.
        const finalFrame = lastFrame;
        const hasFootage = finalFrame !== null;
        if (hasFootage) {
          ffmpeg.write(ebmlFrame(finalFrame, lastOffsetMs + TAIL_MS));
        } else {
          // ffmpeg produces no file at all from an empty stream, which would
          // leave a path pointing at nothing. One frame is a valid, if dull,
          // recording of a case whose page never drew.
          this.#log.warn("record.no_frames", { path });
          ffmpeg.write(ebmlFrame(blankJpeg(), 0));
          ffmpeg.write(ebmlFrame(blankJpeg(), TAIL_MS));
        }

        ffmpeg.end();
        await this.#awaitExit(ffmpeg, path);
        this.#log.info("record.stopped", { path, frames: frameCount });
      },
    };
  }

  async #awaitExit(ffmpeg: FfmpegProcess, path: string): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), STOP_TIMEOUT_MS);
    });

    try {
      const outcome = await Promise.race([ffmpeg.exited, timeout]);
      const timedOut = outcome === "timeout";
      if (timedOut) {
        // Killed so it does not outlive the run. The throw is what matters: a
        // file ffmpeg never finalised has no moov atom, so the caller must
        // report no video rather than a path to something unplayable.
        ffmpeg.kill();
        throw new Error(`ffmpeg did not exit within ${STOP_TIMEOUT_MS}ms: ${path}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * The smallest valid JPEG: one 8x8 white block. Only ever used to give ffmpeg
 * something to mux when a case produced no frames at all.
 */
function blankJpeg(): Uint8Array {
  return Uint8Array.from(
    atob(
      "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////" +
        "////////////////////////////////////////////////////wAALCAAIAAgBAREA" +
        "/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEA" +
        "AD8AKp//2Q==",
    ),
    (character) => character.charCodeAt(0),
  );
}
