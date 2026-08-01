import { describe, expect, test } from "bun:test";
import {
  CLOSE_UPSTREAM_FAILED,
  type DeviceFrame,
  type FrameStream,
  relayFrames,
} from "./device-stream.ts";

/** A stand-in for the gRPC server-streaming call, driven by the test. */
class FakeStream implements FrameStream {
  cancelled = 0;
  #data: ((frame: DeviceFrame) => void)[] = [];
  #error: ((error: Error) => void)[] = [];
  #end: (() => void)[] = [];

  on(event: "data", listener: (frame: DeviceFrame) => void): void;
  on(event: "error", listener: (error: Error) => void): void;
  on(event: "end", listener: () => void): void;
  on(event: "data" | "error" | "end", listener: unknown): void {
    if (event === "data") this.#data.push(listener as (frame: DeviceFrame) => void);
    if (event === "error") this.#error.push(listener as (error: Error) => void);
    if (event === "end") this.#end.push(listener as () => void);
  }

  cancel(): void {
    this.cancelled += 1;
  }

  emitFrame(seq: number, bytes: number[]): void {
    const image = new Uint8Array(new ArrayBuffer(bytes.length));
    image.set(bytes);
    for (const listener of this.#data) listener({ image, seq });
  }

  emitError(error: Error): void {
    for (const listener of this.#error) listener(error);
  }

  emitEnd(): void {
    for (const listener of this.#end) listener();
  }
}

function sink() {
  const sent: Uint8Array<ArrayBuffer>[] = [];
  const closes: { code?: number | undefined; reason?: string | undefined }[] = [];
  return {
    sent,
    closes,
    send: (data: Uint8Array<ArrayBuffer>) => sent.push(data),
    close: (code?: number, reason?: string) => closes.push({ code, reason }),
  };
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];

describe("relayFrames", () => {
  test("forwards every emulator frame to the socket untouched", () => {
    const stream = new FakeStream();
    const out = sink();

    relayFrames(() => stream, out);
    stream.emitFrame(0, [...PNG_MAGIC, 0x01]);
    stream.emitFrame(1, [...PNG_MAGIC, 0x02]);

    expect(out.sent).toHaveLength(2);
    expect([...(out.sent[0] as Uint8Array)]).toEqual([...PNG_MAGIC, 0x01]);
    expect([...(out.sent[1] as Uint8Array)]).toEqual([...PNG_MAGIC, 0x02]);
    expect(out.closes).toHaveLength(0);
  });

  test("cancels the upstream stream when the client disconnects", () => {
    const stream = new FakeStream();
    const out = sink();

    const stop = relayFrames(() => stream, out);
    stream.emitFrame(0, PNG_MAGIC);
    stop();

    expect(stream.cancelled).toBe(1);

    // Frames racing in after the cancel must not reach a closed socket.
    stream.emitFrame(1, PNG_MAGIC);
    expect(out.sent).toHaveLength(1);
  });

  test("is idempotent so a client close after an upstream end cancels once", () => {
    const stream = new FakeStream();
    const out = sink();

    const stop = relayFrames(() => stream, out);
    stop();
    stop();

    expect(stream.cancelled).toBe(1);
  });

  test("closes the socket with the internal-error code when the emulator stream fails", () => {
    const stream = new FakeStream();
    const out = sink();

    relayFrames(() => stream, out);
    stream.emitError(new Error("14 UNAVAILABLE"));

    expect(out.closes).toHaveLength(1);
    expect(out.closes[0]?.code).toBe(CLOSE_UPSTREAM_FAILED);
  });

  test("reports an unreachable emulator instead of throwing at the caller", () => {
    const out = sink();

    const stop = relayFrames(() => {
      throw new Error("connection refused");
    }, out);

    expect(out.closes[0]?.code).toBe(CLOSE_UPSTREAM_FAILED);
    expect(() => stop()).not.toThrow();
  });

  test("does not treat a cancel-induced error as a socket failure", () => {
    const stream = new FakeStream();
    const out = sink();

    const stop = relayFrames(() => stream, out);
    stop();
    // grpc-js surfaces our own cancel() as an error; the client already left.
    stream.emitError(new Error("1 CANCELLED"));

    expect(out.closes).toHaveLength(0);
  });

  test("throttles frames to the configured minimum interval", () => {
    const stream = new FakeStream();
    const out = sink();

    relayFrames(() => stream, out, { minFrameIntervalMs: 60_000 });
    stream.emitFrame(0, PNG_MAGIC);
    stream.emitFrame(1, PNG_MAGIC);
    stream.emitFrame(2, PNG_MAGIC);

    // The first passes immediately; the rest fall inside the window.
    expect(out.sent).toHaveLength(1);
  });

  test("closes the socket cleanly when the emulator ends the stream", () => {
    const stream = new FakeStream();
    const out = sink();

    relayFrames(() => stream, out);
    stream.emitEnd();

    expect(out.closes).toHaveLength(1);
    expect(out.closes[0]?.code).toBeUndefined();
  });
});
