import type { KeyName, SwipeDirection, UiNode } from "@gemma-e2e/core";
import { type Logger, noopLogger } from "@gemma-e2e/logger";
import { COLLECT_JS } from "./collect.ts";
import { CdpConnection, type CdpConnectionOptions, CdpError } from "./connection.ts";
import { type RawTree, toUiNode } from "./dom-walker.ts";

export const DEFAULT_DEBUGGING_PORT = 9222;

/** Enough of a phone-shaped page that a scenario reads the same on both. */
const DEFAULT_VIEWPORT = { width: 1280, height: 900 } as const;

/** One wheel tick per swipe; a page scrolls about a screenful either way. */
const SCROLL_FRACTION = 0.8;

/** How long a navigation may take before the driver stops waiting for quiet. */
const NAVIGATION_TIMEOUT_MS = 15_000;

/**
 * JPEG quality for screencast frames. 80 is the usual compromise: the artifact
 * is a record of what the agent did, not a demo reel, and every point of
 * quality is paid for in encode time and in base64 over the socket.
 */
const SCREENCAST_QUALITY = 80;

export interface Viewport {
  width: number;
  height: number;
}

export interface CdpClientOptions {
  /** Where Chrome is listening, e.g. `http://127.0.0.1:9222`. */
  endpoint?: string | undefined;
  logger?: Logger | undefined;
  connection?: CdpConnectionOptions | undefined;
  /** Injection seam: tests answer `/json/version` without a browser. */
  fetch?: typeof globalThis.fetch | undefined;
}

/** A page opened in its own browser context, which is what a case drives. */
export interface CdpSession {
  readonly sessionId: string;
  readonly targetId: string;
  readonly browserContextId: string;
}

/** One frame of the page, as the screencast encoded it. */
export interface ScreencastFrame {
  /** Base64 JPEG, straight from the protocol. */
  data: string;
  /**
   * Wall-clock milliseconds. What makes a still page recordable: the stream
   * emits nothing while nothing moves, so the gaps have to be reconstructed
   * from when each frame was actually taken.
   */
  timestampMs: number;
}

export type FrameHandler = (frame: ScreencastFrame) => void;

export function endpointOf(port: number = DEFAULT_DEBUGGING_PORT): string {
  return `http://127.0.0.1:${port}`;
}

/**
 * Drives Chrome over the DevTools Protocol.
 *
 * *Why not Puppeteer or Playwright:* what is needed here is a dump, a click, a
 * keystroke and a screenshot. Their value is in browser management, auto-waiting
 * and selector engines, every one of which duplicates something the agent loop
 * already owns -- the loop decides what to wait for, and the model picks targets
 * by ref rather than by selector. The same reasoning kept Appium out on the
 * Android side (docs/knowledge/ui-capture-uiautomator-dump.md).
 */
export class CdpClient {
  readonly #endpoint: string;
  readonly #log: Logger;
  readonly #connectionOptions: CdpConnectionOptions;
  readonly #fetch: typeof globalThis.fetch;
  /** Per page, so a recording and a live view can share one screencast. */
  readonly #frameSubscribers = new Map<string, Set<FrameHandler>>();
  readonly #frameUnsubscribers = new Map<string, () => void>();
  #connection: CdpConnection | null = null;

  constructor(options: CdpClientOptions = {}) {
    this.#endpoint = options.endpoint ?? endpointOf();
    this.#log = options.logger ?? noopLogger;
    this.#connectionOptions = { logger: this.#log, ...options.connection };
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  /**
   * Connects on first use rather than at construction, so a dashboard boots
   * with no browser attached and a missing Chrome surfaces as a case with
   * status=error instead of a startup crash -- matching how adb is treated.
   */
  async #connect(): Promise<CdpConnection> {
    const existing = this.#connection;
    const isConnected = existing !== null;
    if (isConnected) {
      return existing;
    }

    // The browser-level endpoint, not a per-page one: only this socket can
    // issue Target.* and Browser.* commands.
    const url = `${this.#endpoint}/json/version`;
    let webSocketDebuggerUrl: string;
    try {
      const response = await this.#fetch(url);
      const body = (await response.json()) as { webSocketDebuggerUrl?: string };
      const found = body.webSocketDebuggerUrl;
      if (found === undefined) {
        throw new CdpError(`${url} named no webSocketDebuggerUrl`);
      }
      webSocketDebuggerUrl = found;
    } catch (error) {
      throw new CdpError(
        `cannot reach Chrome at ${this.#endpoint}: ${error instanceof Error ? error.message : String(error)}. ` +
          `Start it with --remote-debugging-port=${new URL(this.#endpoint).port}`,
        { cause: error },
      );
    }

    const connection = await CdpConnection.open(webSocketDebuggerUrl, this.#connectionOptions);
    this.#connection = connection;
    return connection;
  }

  /**
   * Opens a page in a context of its own.
   *
   * A fresh browser context per case rather than clearing cookies and storage
   * piecemeal: disposing it drops cookies, localStorage, IndexedDB, cache and
   * permissions together, with nothing left to enumerate and miss. It is what
   * Playwright's `newContext` is, and the closest thing CDP has to `pm clear`.
   */
  async openSession(viewport: Viewport = DEFAULT_VIEWPORT): Promise<CdpSession> {
    const cdp = await this.#connect();

    const { browserContextId } = (await cdp.send("Target.createBrowserContext")) as {
      browserContextId: string;
    };
    const { targetId } = (await cdp.send("Target.createTarget", {
      url: "about:blank",
      browserContextId,
    })) as { targetId: string };
    const { sessionId } = (await cdp.send("Target.attachToTarget", {
      targetId,
      // Multiplexes this page over the one socket; the alternative is the
      // deprecated Target.sendMessageToTarget envelope.
      flatten: true,
    })) as { sessionId: string };

    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);
    // networkIdle is the readiness signal an SPA actually needs; without this
    // only load fires, and that is long before the first fetch settles.
    await cdp.send("Page.setLifecycleEventsEnabled", { enabled: true }, sessionId);
    await cdp.send(
      "Emulation.setDeviceMetricsOverride",
      { ...viewport, deviceScaleFactor: 1, mobile: false },
      sessionId,
    );

    this.#log.debug("cdp.session_opened", { targetId, browserContextId });
    return { sessionId, targetId, browserContextId };
  }

  /** Disposes the context, and with it every trace of what the case did. */
  async closeSession(session: CdpSession): Promise<void> {
    const cdp = await this.#connect();
    await cdp.send("Target.disposeBrowserContext", {
      browserContextId: session.browserContextId,
    });
    this.#log.debug("cdp.session_closed", { targetId: session.targetId });
  }

  /**
   * Navigates and waits for the page to go quiet.
   *
   * Quiet means `networkIdle`, not `load`: a single-page app reaches load with
   * an empty shell, and a dump taken then shows nothing the model can act on.
   * A page that never goes idle -- one polling on a timer -- stops being waited
   * for after {@link NAVIGATION_TIMEOUT_MS}, because the screen is usually
   * usable well before the requests stop.
   */
  async navigate(session: CdpSession, url: string): Promise<void> {
    const cdp = await this.#connect();

    const settled = this.#waitForLifecycle(session, "networkIdle");
    await cdp.send("Page.navigate", { url }, session.sessionId);
    await settled;
  }

  async #waitForLifecycle(session: CdpSession, name: string): Promise<void> {
    const cdp = await this.#connect();

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        off();
        this.#log.debug("cdp.lifecycle_timeout", { name });
        resolve();
      }, NAVIGATION_TIMEOUT_MS);

      const off = cdp.on("Page.lifecycleEvent", (event) => {
        const isOurs = event.sessionId === session.sessionId;
        const isTheOne = isOurs && event.params["name"] === name;
        if (isTheOne) {
          clearTimeout(timer);
          off();
          resolve();
        }
      });
    });
  }

  /** Reads the page as the tree the serializer renders. */
  async dumpUi(session: CdpSession): Promise<UiNode> {
    const raw = await this.#evaluate<RawTree>(session, COLLECT_JS);
    return toUiNode(raw);
  }

  /** `/checkout Kexi Coffee Shop` -- the web answer to a focused activity. */
  async screenLabel(session: CdpSession): Promise<string> {
    const label = await this.#evaluate<string>(
      session,
      `(() => [location.pathname, document.title].filter(Boolean).join(" ").trim())()`,
    );
    return label;
  }

  async #evaluate<T>(session: CdpSession, expression: string): Promise<T> {
    const cdp = await this.#connect();
    const response = (await cdp.send(
      "Runtime.evaluate",
      { expression, returnByValue: true, awaitPromise: true },
      session.sessionId,
    )) as {
      result?: { value?: T };
      exceptionDetails?: { text?: string; exception?: { description?: string } };
    };

    const thrown = response.exceptionDetails;
    const failed = thrown !== undefined;
    if (failed) {
      throw new CdpError(
        `the page threw while being read: ${thrown.exception?.description ?? thrown.text ?? "unknown"}`,
      );
    }

    const value = response.result?.value;
    const isMissing = value === undefined;
    if (isMissing) {
      throw new CdpError("the page returned nothing where a value was expected");
    }
    return value;
  }

  /**
   * Clicks at a point.
   *
   * Press and release are separate events with no "click" between them, and
   * `clickCount` must be set: without it the events fire but the browser
   * synthesises no click, so focus and selection quietly misbehave. A move
   * comes first because hover-activated menus open on it.
   */
  async tap(session: CdpSession, x: number, y: number): Promise<void> {
    const cdp = await this.#connect();
    const at = { x, y, button: "left", clickCount: 1 };

    await cdp.send("Input.dispatchMouseEvent", { ...at, type: "mouseMoved" }, session.sessionId);
    await cdp.send(
      "Input.dispatchMouseEvent",
      { ...at, type: "mousePressed", buttons: 1 },
      session.sessionId,
    );
    await cdp.send("Input.dispatchMouseEvent", { ...at, type: "mouseReleased" }, session.sessionId);
  }

  /**
   * Types into whatever holds focus.
   *
   * `Input.insertText` rather than a keystroke per character: it is one round
   * trip, unicode-safe, and fires the `input` event React and friends listen
   * for. It fires no key events, so a field that filters keystrokes or submits
   * on Enter needs {@link keyevent} as well -- which is how the loop already
   * spells "press enter".
   */
  async typeText(session: CdpSession, text: string): Promise<void> {
    const cdp = await this.#connect();
    await cdp.send("Input.insertText", { text }, session.sessionId);
  }

  /**
   * Scrolls by about a screenful.
   *
   * A wheel event rather than `Input.synthesizeScrollGesture`: the gesture
   * pipeline animates in real time, so every scroll would cost the run a
   * second, and it is flaky headless. The wheel is instant and deterministic,
   * which is what a test wants.
   */
  async swipe(session: CdpSession, direction: SwipeDirection): Promise<void> {
    const cdp = await this.#connect();
    const { width, height } = await this.#viewport(session);

    // A swipe names the finger's direction, so the content moves that way and
    // the viewport moves opposite: swiping up reveals what is below.
    const distanceY = Math.round(height * SCROLL_FRACTION);
    const distanceX = Math.round(width * SCROLL_FRACTION);
    const deltas: Record<SwipeDirection, { deltaX: number; deltaY: number }> = {
      up: { deltaX: 0, deltaY: distanceY },
      down: { deltaX: 0, deltaY: -distanceY },
      left: { deltaX: distanceX, deltaY: 0 },
      right: { deltaX: -distanceX, deltaY: 0 },
    };

    await cdp.send(
      "Input.dispatchMouseEvent",
      {
        type: "mouseWheel",
        x: Math.round(width / 2),
        y: Math.round(height / 2),
        ...deltas[direction],
      },
      session.sessionId,
    );
  }

  /**
   * Presses one of the loop's three keys.
   *
   * `back` and `home` are navigation on a phone and navigation here too: they
   * go back through history and to the site root. Only `enter` is a real
   * keystroke, and it needs `text: "\r"` -- without it the key event fires but
   * no character is produced, so a form does not submit.
   */
  async keyevent(session: CdpSession, key: KeyName): Promise<void> {
    const cdp = await this.#connect();

    switch (key) {
      case "back":
        await this.#evaluate(session, "(() => { history.back(); return true })()");
        return;
      case "home":
        await this.#evaluate(session, "(() => { location.href = '/'; return true })()");
        return;
      case "enter": {
        const stroke = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" };
        await cdp.send("Input.dispatchKeyEvent", { ...stroke, type: "keyDown" }, session.sessionId);
        await cdp.send("Input.dispatchKeyEvent", { ...stroke, type: "keyUp" }, session.sessionId);
        return;
      }
    }
  }

  /** Writes a PNG of the viewport and returns the path it landed on. */
  async screencap(session: CdpSession, destPath: string): Promise<string> {
    const cdp = await this.#connect();
    const { data } = (await cdp.send(
      "Page.captureScreenshot",
      { format: "png" },
      session.sessionId,
    )) as { data: string };

    await Bun.write(destPath, Buffer.from(data, "base64"));
    return destPath;
  }

  async #viewport(session: CdpSession): Promise<Viewport> {
    return await this.#evaluate<Viewport>(
      session,
      "(() => ({ width: innerWidth, height: innerHeight }))()",
    );
  }

  /**
   * Subscribes to the page's frames, starting the screencast on the first
   * subscriber and stopping it on the last. Returns the unsubscribe function.
   *
   * Chromium allows one screencast per page: a second `startScreencast` on the
   * same target reconfigures the first rather than adding to it, and either
   * consumer calling `stopScreencast` ends it for both. So the stream is
   * started once and the frames are handed out here -- which is what lets a
   * recording and a live view watch the same case at once.
   *
   * Frames are acknowledged as they arrive. Chromium caps how many may be
   * outstanding and simply stops sending once the cap is reached, so a missed
   * ack does not slow the stream down, it ends it.
   */
  async onFrames(session: CdpSession, handler: FrameHandler): Promise<() => void> {
    const cdp = await this.#connect();

    const existing = this.#frameSubscribers.get(session.sessionId);
    const subscribers = existing ?? new Set<FrameHandler>();
    const isFirst = subscribers.size === 0;
    subscribers.add(handler);
    this.#frameSubscribers.set(session.sessionId, subscribers);

    if (isFirst) {
      const off = cdp.on("Page.screencastFrame", (event) => {
        const isOurs = event.sessionId === session.sessionId;
        if (!isOurs) {
          return;
        }

        const params = event.params as {
          data: string;
          sessionId: number;
          metadata?: { timestamp?: number };
        };
        // Acknowledged before the handlers run: a slow consumer must not be
        // able to stall the stream for the others.
        void cdp
          .send("Page.screencastFrameAck", { sessionId: params.sessionId }, session.sessionId)
          .catch(() => {
            // The page is gone, which the case is about to notice anyway.
          });

        const frame: ScreencastFrame = {
          data: params.data,
          timestampMs: (params.metadata?.timestamp ?? 0) * 1000,
        };
        for (const subscriber of Array.from(subscribers)) {
          subscriber(frame);
        }
      });
      this.#frameUnsubscribers.set(session.sessionId, off);

      await cdp.send(
        "Page.startScreencast",
        { format: "jpeg", quality: SCREENCAST_QUALITY, everyNthFrame: 1 },
        session.sessionId,
      );
    }

    return () => {
      subscribers.delete(handler);
      const isLast = subscribers.size === 0;
      if (!isLast) {
        return;
      }

      this.#frameSubscribers.delete(session.sessionId);
      this.#frameUnsubscribers.get(session.sessionId)?.();
      this.#frameUnsubscribers.delete(session.sessionId);
      // Not awaited: the caller is tearing down, and a page already disposed
      // would reject here for a stream that no longer exists.
      void this.#connection
        ?.send("Page.stopScreencast", {}, session.sessionId)
        .catch(() => undefined);
    };
  }

  /** Drops the socket. Sessions opened on it are gone with it. */
  close(): void {
    this.#connection?.close();
    this.#connection = null;
    this.#frameSubscribers.clear();
    this.#frameUnsubscribers.clear();
  }
}
