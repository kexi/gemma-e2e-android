import type { CdpClient, CdpSession, Viewport } from "@gemma-e2e/cdp";
import { errorFields, type Logger, noopLogger } from "@gemma-e2e/logger";
import type { DeviceStatus, FrameStream } from "./device-stream.ts";

export interface CdpDeviceOptions {
  /** The page the live view shows when no case is running. */
  url?: string | undefined;
  viewport?: Viewport | undefined;
  logger?: Logger | undefined;
}

/** Where the live view points before a run gives it something to watch. */
const DEFAULT_URL = "about:blank";

/**
 * The browser half of the Device page.
 *
 * Satisfies the same {@link DeviceSource} the emulator does, so the page, the
 * WebSocket relay and the frontend are unchanged -- the difference is only
 * where the frames come from.
 *
 * *Why this opens a page of its own:* the live view outlives any single case,
 * and the pages a run opens are disposed with their browser contexts. Sharing
 * one would mean the view going blank between cases and, worse, holding a
 * context open past the case that was supposed to isolate it.
 */
export class CdpDeviceSource {
  readonly #cdp: CdpClient;
  readonly #url: string;
  readonly #viewport: Viewport | undefined;
  readonly #log: Logger;
  #session: CdpSession | null = null;

  constructor(cdp: CdpClient, options: CdpDeviceOptions = {}) {
    this.#cdp = cdp;
    this.#url = options.url ?? DEFAULT_URL;
    this.#viewport = options.viewport;
    this.#log = options.logger ?? noopLogger;
  }

  /**
   * Opens the view's page on first use and reuses it after.
   *
   * A page that has gone away -- Chrome restarted, the context disposed --
   * shows up as a failed command, so the session is dropped and reopened
   * rather than kept as a handle to something that no longer exists.
   */
  async #page(): Promise<CdpSession> {
    const existing = this.#session;
    const isOpen = existing !== null;
    if (isOpen) {
      try {
        await this.#cdp.screenLabel(existing);
        return existing;
      } catch (error) {
        this.#log.debug("device.page_reopening", errorFields(error));
        this.#session = null;
      }
    }

    const session = await this.#cdp.openSession(this.#viewport);
    await this.#cdp.navigate(session, this.#url);
    this.#session = session;
    return session;
  }

  /**
   * Reports the browser as the Device page's status shape.
   *
   * `uptimeMs` is null and `booted` is whether the page answered: a browser
   * has no boot to time, and inventing a number would put a figure on the
   * dashboard that means nothing.
   */
  async getStatus(): Promise<DeviceStatus> {
    const session = await this.#page();
    const label = await this.#cdp.screenLabel(session);

    return {
      uptimeMs: null,
      booted: true,
      // The Device page reads hw.lcd.* for the frame's aspect; anything else
      // here is shown as-is, so the current page is worth naming.
      hardwareConfig: {
        "hw.lcd.width": String(this.#viewport?.width ?? ""),
        "hw.lcd.height": String(this.#viewport?.height ?? ""),
        "cdp.page": label,
      },
    };
  }

  /**
   * Adapts the screencast to the emitter shape the relay expects.
   *
   * The relay was written against gRPC's server-streaming call, which is an
   * emitter with `data`/`error`/`end` and a `cancel`. Presenting the screencast
   * that way is cheaper than teaching the relay a second protocol, and keeps
   * both platforms on one throttle and one teardown path.
   */
  openFrameStream(): FrameStream {
    const handlers: {
      data?: (frame: { image: Uint8Array<ArrayBuffer>; seq: number }) => void;
      error?: (error: Error) => void;
      end?: () => void;
    } = {};

    let unsubscribe: (() => void) | null = null;
    let cancelled = false;
    let seq = 0;

    // Subscription is async while `FrameStream` is not, so it is started here
    // and its failure reported through the same `error` the relay already
    // handles -- which is how a browser that is not running reaches the
    // client as a closed socket rather than an unhandled rejection.
    void this.#page()
      .then(async (session) => {
        const off = await this.#cdp.onFrames(session, (frame) => {
          const isStale = cancelled;
          if (isStale) {
            return;
          }
          seq += 1;
          handlers.data?.({
            // Decoded once per frame, so the cheap path matters more here than
            // anywhere else the protocol's base64 is unpacked.
            image: new Uint8Array(Buffer.from(frame.data, "base64")) as Uint8Array<ArrayBuffer>,
            seq,
          });
        });

        const wasCancelledWhileOpening = cancelled;
        if (wasCancelledWhileOpening) {
          off();
          return;
        }
        unsubscribe = off;
      })
      .catch((error: unknown) => {
        this.#log.warn("device.screencast_failed", errorFields(error));
        handlers.error?.(error instanceof Error ? error : new Error(String(error)));
      });

    return {
      on(event: "data" | "error" | "end", listener: (arg: never) => void): void {
        // Assigned by name rather than pushed onto a list: the relay registers
        // exactly one of each, and a second would be a bug worth noticing.
        handlers[event] = listener as never;
      },
      cancel: () => {
        cancelled = true;
        unsubscribe?.();
        unsubscribe = null;
      },
    };
  }

  /** Drops the live view's page, if it opened one. */
  async close(): Promise<void> {
    const session = this.#session;
    const isOpen = session !== null;
    if (!isOpen) {
      return;
    }
    this.#session = null;
    await this.#cdp.closeSession(session);
  }
}
