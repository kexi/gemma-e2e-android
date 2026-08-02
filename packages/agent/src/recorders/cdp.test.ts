import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CdpRecorder, type FfmpegProcess, type ScreencastFrame } from "./cdp.ts";

/** A one-pixel JPEG, base64, as the protocol delivers a frame. */
const FRAME_DATA = btoa("\xff\xd8\xff\xd9");

/**
 * Stands in for ffmpeg: collects everything written and exits when told. What
 * a test asserts on is the byte stream, since that is the whole interface
 * between this recorder and the muxer.
 */
class FakeFfmpeg implements FfmpegProcess {
  readonly chunks: Uint8Array[] = [];
  readonly exited: Promise<number>;
  ended = false;
  killed = false;
  #resolve!: (code: number) => void;

  constructor(private readonly exitsOnEnd = true) {
    this.exited = new Promise((resolve) => {
      this.#resolve = resolve;
    });
  }

  write(chunk: Uint8Array): void {
    this.chunks.push(chunk);
  }

  end(): void {
    this.ended = true;
    if (this.exitsOnEnd) this.#resolve(0);
  }

  kill(): void {
    this.killed = true;
    this.#resolve(137);
  }

  /** Every cluster written, which is one per frame. */
  clusters(): Uint8Array[] {
    return this.chunks.filter(
      (chunk) => chunk[0] === 0x1f && chunk[1] === 0x43 && chunk[2] === 0xb6 && chunk[3] === 0x75,
    );
  }
}

/** Drives the recorder's frame subscription from a test. */
class FakePage {
  #handler: ((frame: ScreencastFrame) => void) | null = null;
  unsubscribed = false;

  subscribe = async (handler: (frame: ScreencastFrame) => void): Promise<() => void> => {
    this.#handler = handler;
    return () => {
      this.unsubscribed = true;
    };
  };

  emit(timestampMs: number, data = FRAME_DATA): void {
    this.#handler?.({ data, timestampMs });
  }
}

async function withVideoDir<T>(body: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "cdp-rec-"));
  try {
    return await body(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function recorder(dir: string, page: FakePage, ffmpeg: FakeFfmpeg) {
  return new CdpRecorder({
    videoDir: dir,
    subscribe: page.subscribe,
    width: 1280,
    height: 900,
    spawn: () => ffmpeg,
  });
}

describe("CdpRecorder", () => {
  test("writes the video where the dashboard already serves it from", async () => {
    await withVideoDir(async (dir) => {
      const page = new FakePage();
      const ffmpeg = new FakeFfmpeg();

      const recording = await recorder(dir, page, ffmpeg).start({
        runId: "run-1",
        caseId: "logs-in",
      });

      expect(recording.path).toBe(join(dir, "run-1", "logs-in.mp4"));
    });
  });

  test("opens the stream with a header before any frame", async () => {
    await withVideoDir(async (dir) => {
      const page = new FakePage();
      const ffmpeg = new FakeFfmpeg();

      await recorder(dir, page, ffmpeg).start({ runId: "run-1", caseId: "logs-in" });

      const first = ffmpeg.chunks[0] as Uint8Array;
      expect(Array.from(first.slice(0, 4))).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
    });
  });

  test("times frames from the first one, not from whenever the browser started", async () => {
    await withVideoDir(async (dir) => {
      const page = new FakePage();
      const ffmpeg = new FakeFfmpeg();
      const recording = await recorder(dir, page, ffmpeg).start({
        runId: "run-1",
        caseId: "logs-in",
      });

      // Wall-clock timestamps, as the protocol reports them.
      page.emit(1_700_000_000_000);
      page.emit(1_700_000_002_000);
      await recording.stop();

      // Three clusters: two frames plus the held tail.
      expect(ffmpeg.clusters()).toHaveLength(3);
      expect(timecodeOf(ffmpeg.clusters()[0] as Uint8Array)).toBe(0);
      expect(timecodeOf(ffmpeg.clusters()[1] as Uint8Array)).toBe(2000);
    });
  });

  test("keeps the gap where a still page sent nothing", async () => {
    // The reason the whole EBML detour exists: the screencast emits on change
    // only, so ten quiet seconds arrive as two frames ten seconds apart. If the
    // gap were dropped the recording would run faster than the run.
    await withVideoDir(async (dir) => {
      const page = new FakePage();
      const ffmpeg = new FakeFfmpeg();
      const recording = await recorder(dir, page, ffmpeg).start({
        runId: "run-1",
        caseId: "logs-in",
      });

      page.emit(0);
      page.emit(10_000);
      await recording.stop();

      expect(timecodeOf(ffmpeg.clusters()[1] as Uint8Array)).toBe(10_000);
    });
  });

  test("holds the last frame, so a case does not end on a blink", async () => {
    await withVideoDir(async (dir) => {
      const page = new FakePage();
      const ffmpeg = new FakeFfmpeg();
      const recording = await recorder(dir, page, ffmpeg).start({
        runId: "run-1",
        caseId: "logs-in",
      });

      page.emit(0);
      page.emit(500);
      await recording.stop();

      const tail = ffmpeg.clusters().at(-1) as Uint8Array;
      expect(timecodeOf(tail)).toBe(1500);
    });
  });

  test("writes a frame even when the page never drew one", async () => {
    // ffmpeg produces no file at all from an empty stream, which would leave
    // CaseRun.videoPath pointing at nothing.
    await withVideoDir(async (dir) => {
      const page = new FakePage();
      const ffmpeg = new FakeFfmpeg();
      const recording = await recorder(dir, page, ffmpeg).start({
        runId: "run-1",
        caseId: "logs-in",
      });

      await recording.stop();

      expect(ffmpeg.clusters().length).toBeGreaterThan(0);
    });
  });

  test("stops listening to the page before closing the stream", async () => {
    await withVideoDir(async (dir) => {
      const page = new FakePage();
      const ffmpeg = new FakeFfmpeg();
      const recording = await recorder(dir, page, ffmpeg).start({
        runId: "run-1",
        caseId: "logs-in",
      });

      page.emit(0);
      await recording.stop();

      expect(page.unsubscribed).toBe(true);
      expect(ffmpeg.ended).toBe(true);
    });
  });

  test("rounds the frame size to even, which encoders require", async () => {
    await withVideoDir(async (dir) => {
      const ffmpeg = new FakeFfmpeg();
      const odd = new CdpRecorder({
        videoDir: dir,
        subscribe: new FakePage().subscribe,
        width: 1281,
        height: 901,
        spawn: () => ffmpeg,
      });

      await odd.start({ runId: "run-1", caseId: "logs-in" });

      const header = ffmpeg.chunks[0] as Uint8Array;
      expect(readSize(header, 0xb0)).toBe(1280);
      expect(readSize(header, 0xba)).toBe(900);
    });
  });

  test("reports a recording ffmpeg never finalised, rather than a broken path", async () => {
    // A file with no moov atom opens in no player, so the caller has to hear
    // about it and report no video at all.
    await withVideoDir(async (dir) => {
      const page = new FakePage();
      const hung = new FakeFfmpeg(false);
      const recording = await new CdpRecorder({
        videoDir: dir,
        subscribe: page.subscribe,
        width: 320,
        height: 240,
        spawn: () => hung,
      }).start({ runId: "run-1", caseId: "logs-in" });

      page.emit(0);

      await expect(recording.stop()).rejects.toThrow(/did not exit/);
      expect(hung.killed).toBe(true);
    });
  }, 20_000); // this case has to outlast that. // The recorder waits STOP_TIMEOUT_MS (10s) before giving up on ffmpeg, so

  test("keeps recording when one frame cannot be written", async () => {
    await withVideoDir(async (dir) => {
      const page = new FakePage();
      const ffmpeg = new FakeFfmpeg();
      let failNext = false;
      const flaky: FfmpegProcess = {
        exited: ffmpeg.exited,
        write: (chunk) => {
          if (failNext) {
            failNext = false;
            throw new Error("EPIPE");
          }
          ffmpeg.write(chunk);
        },
        end: () => ffmpeg.end(),
        kill: () => ffmpeg.kill(),
      };
      const recording = await new CdpRecorder({
        videoDir: dir,
        subscribe: page.subscribe,
        width: 320,
        height: 240,
        spawn: () => flaky,
      }).start({ runId: "run-1", caseId: "logs-in" });

      page.emit(0);
      failNext = true;
      expect(() => page.emit(100)).not.toThrow();
      page.emit(200);
      await recording.stop();

      expect(ffmpeg.ended).toBe(true);
    });
  });
});

/** The timecode a cluster declares, decoded the way a demuxer would. */
function timecodeOf(cluster: Uint8Array): number {
  const marker = cluster.indexOf(0xe7);
  const first = cluster[marker + 1] as number;
  let lengthBytes = 1;
  while (lengthBytes <= 8 && (first & (1 << (8 - lengthBytes))) === 0) lengthBytes++;
  let size = first & ((1 << (8 - lengthBytes)) - 1);
  for (let index = 1; index < lengthBytes; index++) {
    size = size * 256 + (cluster[marker + 1 + index] as number);
  }
  let value = 0;
  const start = marker + 1 + lengthBytes;
  for (let index = 0; index < size; index++) {
    value = value * 256 + (cluster[start + index] as number);
  }
  return value;
}

/** PixelWidth/PixelHeight as the header declared them. */
function readSize(header: Uint8Array, id: number): number {
  const marker = header.indexOf(id);
  const length = (header[marker + 1] as number) & 0x7f;
  let value = 0;
  for (let index = 0; index < length; index++) {
    value = value * 256 + (header[marker + 2 + index] as number);
  }
  return value;
}
