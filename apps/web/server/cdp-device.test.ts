import { describe, expect, test } from "bun:test";
import type { CdpClient, CdpSession, FrameHandler } from "@gemma-e2e/cdp";
import { CdpDeviceSource } from "./cdp-device.ts";
import type { DeviceFrame } from "./device-stream.ts";

/** A one-pixel JPEG, base64, as the screencast delivers a frame. */
const FRAME_DATA = btoa("\xff\xd8\xff\xd9");

/**
 * Stands in for the CDP client. Only the four methods the live view calls are
 * modelled, which is what makes it a fair test of the seam rather than of the
 * browser.
 */
class FakeCdp {
  readonly calls: string[] = [];
  readonly closed: string[] = [];
  opened = 0;
  label = "/ Kexi Coffee Shop";
  /** Set to fail `screenLabel`, standing in for a page that has gone away. */
  labelFails = false;
  /** Set to fail `openSession`, standing in for a browser that is not running. */
  openFails = false;

  #handler: FrameHandler | null = null;
  unsubscribed = 0;

  openSession = async (): Promise<CdpSession> => {
    this.calls.push("openSession");
    if (this.openFails) {
      throw new Error("cannot reach Chrome");
    }
    this.opened += 1;
    const id = String(this.opened);
    return { sessionId: `S${id}`, targetId: `T${id}`, browserContextId: `C${id}` };
  };

  closeSession = async (session: CdpSession): Promise<void> => {
    this.calls.push("closeSession");
    this.closed.push(session.sessionId);
  };

  navigate = async (_session: CdpSession, url: string): Promise<void> => {
    this.calls.push(`navigate:${url}`);
  };

  screenLabel = async (): Promise<string> => {
    this.calls.push("screenLabel");
    if (this.labelFails) {
      throw new Error("no such target");
    }
    return this.label;
  };

  #onClosed: ((error: Error) => void) | null = null;

  onFrames = async (
    _session: CdpSession,
    handler: FrameHandler,
    onClosed?: (error: Error) => void,
  ): Promise<() => void> => {
    this.calls.push("onFrames");
    this.#handler = handler;
    this.#onClosed = onClosed ?? null;
    return () => {
      this.unsubscribed += 1;
      this.#handler = null;
      this.#onClosed = null;
    };
  };

  /** The devtools socket going away, as the connection reports it. */
  dropConnection(reason = "the devtools connection closed"): void {
    this.#onClosed?.(new Error(reason));
  }

  emit(data = FRAME_DATA): void {
    this.#handler?.({ data, timestampMs: 0 });
  }

  /** True once a subscriber is attached, which `onFrames` resolves into. */
  get streaming(): boolean {
    return this.#handler !== null;
  }
}

function source(cdp: FakeCdp, url = "http://localhost:5174"): CdpDeviceSource {
  return new CdpDeviceSource(cdp as unknown as CdpClient, {
    url,
    viewport: { width: 1280, height: 900 },
  });
}

describe("CdpDeviceSource status", () => {
  test("opens a page of its own and points it at the live view url", async () => {
    const cdp = new FakeCdp();

    await source(cdp).getStatus();

    expect(cdp.calls).toContain("openSession");
    expect(cdp.calls).toContain("navigate:http://localhost:5174");
  });

  test("reuses the page it already opened", async () => {
    const cdp = new FakeCdp();
    const device = source(cdp);

    await device.getStatus();
    await device.getStatus();

    expect(cdp.opened).toBe(1);
  });

  test("reopens after the page goes away, rather than holding a dead handle", async () => {
    // Chrome restarted, or the context was disposed: the next command fails,
    // and a live view that kept the handle would stay blank until a reboot.
    const cdp = new FakeCdp();
    const device = source(cdp);
    await device.getStatus();

    cdp.labelFails = true;
    await device.getStatus().catch(() => undefined);
    cdp.labelFails = false;
    await device.getStatus();

    expect(cdp.opened).toBeGreaterThan(1);
  });

  test("reports no uptime, because a browser has no boot to time", async () => {
    // Inventing a number would put a figure on the dashboard that means
    // nothing.
    const status = await source(new FakeCdp()).getStatus();

    expect(status.uptimeMs).toBeNull();
    expect(status.booted).toBe(true);
  });

  test("names the page it is showing, where a device names its hardware", async () => {
    const cdp = new FakeCdp();
    cdp.label = "/checkout Kexi Coffee Shop";

    const status = await source(cdp).getStatus();

    expect(status.hardwareConfig["cdp.page"]).toBe("/checkout Kexi Coffee Shop");
    expect(status.hardwareConfig["hw.lcd.width"]).toBe("1280");
  });

  test("fails the status when the browser is not running", async () => {
    // Which the Device page renders as guidance rather than as a crash.
    const cdp = new FakeCdp();
    cdp.openFails = true;

    await expect(source(cdp).getStatus()).rejects.toThrow(/cannot reach Chrome/);
  });
});

describe("CdpDeviceSource frames", () => {
  test("delivers screencast frames as the relay's data events", async () => {
    const cdp = new FakeCdp();
    const frames: DeviceFrame[] = [];

    const stream = source(cdp).openFrameStream();
    stream.on("data", (frame) => frames.push(frame));
    await Bun.sleep(10);
    cdp.emit();

    expect(frames).toHaveLength(1);
    // Decoded, not base64: the relay pushes raw bytes down the socket, and
    // re-encoding would inflate every frame by a third for no gain.
    expect(Array.from(frames[0]?.image ?? [])).toEqual([0xff, 0xd8, 0xff, 0xd9]);
  });

  test("numbers frames, so a client can tell one from the next", async () => {
    const cdp = new FakeCdp();
    const seqs: number[] = [];

    const stream = source(cdp).openFrameStream();
    stream.on("data", (frame) => seqs.push(frame.seq));
    await Bun.sleep(10);
    cdp.emit();
    cdp.emit();

    expect(seqs).toEqual([1, 2]);
  });

  test("stops the screencast when the client goes away", async () => {
    const cdp = new FakeCdp();

    const stream = source(cdp).openFrameStream();
    await Bun.sleep(10);
    stream.cancel();

    expect(cdp.unsubscribed).toBe(1);
    expect(cdp.streaming).toBe(false);
  });

  test("delivers nothing after cancelling, however late a frame arrives", async () => {
    const cdp = new FakeCdp();
    const frames: DeviceFrame[] = [];

    const stream = source(cdp).openFrameStream();
    stream.on("data", (frame) => frames.push(frame));
    await Bun.sleep(10);
    stream.cancel();
    cdp.emit();

    expect(frames).toHaveLength(0);
  });

  test("stops a screencast cancelled before it finished opening", async () => {
    // The subscription is async while the stream interface is not, so a client
    // that leaves immediately would otherwise leave the screencast running
    // with nobody watching it.
    const cdp = new FakeCdp();

    const stream = source(cdp).openFrameStream();
    stream.cancel();
    await Bun.sleep(10);

    expect(cdp.streaming).toBe(false);
  });

  test("reports a dropped devtools connection, so the client socket closes", async () => {
    // A frame consumer has no command in flight to be rejected, so without
    // this the stream merely stops delivering -- indistinguishable from a
    // quiet page -- and the browser's WebSocket stays open indefinitely.
    const cdp = new FakeCdp();
    const errors: Error[] = [];

    const stream = source(cdp).openFrameStream();
    stream.on("error", (error) => errors.push(error));
    await Bun.sleep(10);
    cdp.dropConnection();

    expect(errors[0]?.message).toMatch(/devtools connection closed/);
  });

  test("delivers nothing after the connection drops", async () => {
    const cdp = new FakeCdp();
    const frames: DeviceFrame[] = [];

    const stream = source(cdp).openFrameStream();
    stream.on("data", (frame) => frames.push(frame));
    stream.on("error", () => {});
    await Bun.sleep(10);
    cdp.dropConnection();
    cdp.emit();

    expect(frames).toHaveLength(0);
  });

  test("reports a browser it cannot reach through the relay's error path", async () => {
    // Which reaches the client as a closed socket, rather than as an unhandled
    // rejection nothing surfaces.
    const cdp = new FakeCdp();
    cdp.openFails = true;
    const errors: Error[] = [];

    const stream = source(cdp).openFrameStream();
    stream.on("error", (error) => errors.push(error));
    await Bun.sleep(10);

    expect(errors[0]?.message).toMatch(/cannot reach Chrome/);
  });
});

describe("CdpDeviceSource teardown", () => {
  test("disposes the live view's page", async () => {
    const cdp = new FakeCdp();
    const device = source(cdp);
    await device.getStatus();

    await device.close();

    expect(cdp.closed).toEqual(["S1"]);
  });

  test("closing before anything opened is a no-op", async () => {
    const cdp = new FakeCdp();

    await source(cdp).close();

    expect(cdp.closed).toEqual([]);
  });
});
