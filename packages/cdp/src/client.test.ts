import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CdpClient, type CdpSession } from "./client.ts";
import { CdpError, type SocketLike } from "./connection.ts";

/** What one command sent looked like, flattened for readable assertions. */
interface Sent {
  method: string;
  params: Record<string, unknown>;
  sessionId?: string | undefined;
}

/**
 * A Chrome stand-in: answers each command from a table keyed by method, and
 * lets a test push lifecycle events. Everything the client does is a command,
 * so this covers the whole surface without a browser.
 */
class FakeChrome implements SocketLike {
  readonly sent: Sent[] = [];
  readonly readyState = 1;
  closed = false;

  /** Per-method results; a method with no entry answers `{}`. */
  results: Record<string, Record<string, unknown>> = {};
  /** Methods that should answer with a protocol error instead. */
  errors: Record<string, string> = {};
  /** Fires `Page.lifecycleEvent` with this name as soon as a navigate is sent. */
  lifecycleOnNavigate: string | null = "networkIdle";

  #onMessage: ((event: { data: unknown }) => void) | undefined;

  send(data: string): void {
    const message = JSON.parse(data) as {
      id: number;
      method: string;
      params: Record<string, unknown>;
      sessionId?: string;
    };
    this.sent.push({
      method: message.method,
      params: message.params,
      ...(message.sessionId === undefined ? {} : { sessionId: message.sessionId }),
    });

    const failure = this.errors[message.method];
    const hasFailed = failure !== undefined;
    if (hasFailed) {
      this.#deliver({ id: message.id, error: { code: -32000, message: failure } });
      return;
    }

    this.#deliver({ id: message.id, result: this.results[message.method] ?? {} });

    const isNavigate = message.method === "Page.navigate";
    const announces = isNavigate && this.lifecycleOnNavigate !== null;
    if (announces) {
      this.#deliver({
        method: "Page.lifecycleEvent",
        params: { name: this.lifecycleOnNavigate },
        sessionId: message.sessionId,
      });
    }
  }

  /** Pushes a lifecycle event a test controls the timing of. */
  /** Pushes a screencast frame, as the page would when it repaints. */
  announceFrame(sessionId: string, data = btoa("\xff\xd8\xff\xd9")): void {
    this.#deliver({
      method: "Page.screencastFrame",
      params: { data, sessionId: 1, metadata: { timestamp: 1 } },
      sessionId,
    });
  }

  announceLifecycle(name: string, sessionId: string): void {
    this.#deliver({ method: "Page.lifecycleEvent", params: { name }, sessionId });
  }

  #deliver(message: unknown): void {
    // Asynchronously, as a socket would: a reply must never arrive before the
    // caller has had a chance to await it.
    queueMicrotask(() => this.#onMessage?.({ data: JSON.stringify(message) }));
  }

  close(): void {
    this.closed = true;
  }

  addEventListener(type: string, handler: (event: never) => void): void {
    if (type === "message") this.#onMessage = handler as (event: { data: unknown }) => void;
  }

  /** Every command of one method, in the order they were sent. */
  ofMethod(method: string): Sent[] {
    return this.sent.filter((one) => one.method === method);
  }

  methodNames(): string[] {
    return this.sent.map((one) => one.method);
  }
}

/** A client wired to the fake, with `/json/version` answered in-process. */
function client(chrome: FakeChrome): CdpClient {
  return new CdpClient({
    endpoint: "http://127.0.0.1:9222",
    fetch: (async () =>
      new Response(
        JSON.stringify({ webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/x" }),
      )) as unknown as typeof globalThis.fetch,
    connection: { socket: () => chrome, timeoutMs: 200 },
  });
}

/** Opens a session with the ids a test can then assert against. */
async function openSession(chrome: FakeChrome, cdp: CdpClient): Promise<CdpSession> {
  chrome.results["Target.createBrowserContext"] = { browserContextId: "C1" };
  chrome.results["Target.createTarget"] = { targetId: "T1" };
  chrome.results["Target.attachToTarget"] = { sessionId: "S1" };
  return await cdp.openSession();
}

describe("connecting", () => {
  test("explains how to start Chrome when nothing is listening", async () => {
    const cdp = new CdpClient({
      endpoint: "http://127.0.0.1:9222",
      fetch: (async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof globalThis.fetch,
    });

    await expect(cdp.openSession()).rejects.toThrow(/--remote-debugging-port=9222/);
  });

  test("opens one socket for callers that arrive together", async () => {
    // The Device page polls getStatus() while a run drives cases through the
    // same client, so this overlap happens in production. Without it each
    // caller opened its own socket and all but the last were leaked, since
    // close() can only drop the connection it can see.
    const chrome = new FakeChrome();
    let sockets = 0;
    const cdp = new CdpClient({
      endpoint: "http://127.0.0.1:9222",
      fetch: (async () =>
        new Response(
          JSON.stringify({ webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/x" }),
        )) as unknown as typeof globalThis.fetch,
      connection: {
        socket: () => {
          sockets += 1;
          return chrome;
        },
      },
    });
    chrome.results["Target.createBrowserContext"] = { browserContextId: "C1" };
    chrome.results["Target.createTarget"] = { targetId: "T1" };
    chrome.results["Target.attachToTarget"] = { sessionId: "S1" };

    await Promise.all([cdp.openSession(), cdp.openSession(), cdp.openSession()]);

    expect(sockets).toBe(1);
  });

  test("retries after a failed connect rather than caching the failure", async () => {
    // The in-flight promise is cleared however it settles, so a browser that
    // was not running when the first caller tried does not poison later ones.
    const chrome = new FakeChrome();
    let attempts = 0;
    const cdp = new CdpClient({
      endpoint: "http://127.0.0.1:9222",
      fetch: (async () => {
        attempts += 1;
        const isFirst = attempts === 1;
        if (isFirst) {
          throw new Error("ECONNREFUSED");
        }
        return new Response(
          JSON.stringify({ webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/x" }),
        );
      }) as unknown as typeof globalThis.fetch,
      connection: { socket: () => chrome },
    });
    chrome.results["Target.createBrowserContext"] = { browserContextId: "C1" };
    chrome.results["Target.createTarget"] = { targetId: "T1" };
    chrome.results["Target.attachToTarget"] = { sessionId: "S1" };

    await expect(cdp.openSession()).rejects.toThrow(/ECONNREFUSED/);

    expect((await cdp.openSession()).sessionId).toBe("S1");
  });

  test("refuses an endpoint that answers without a debugger url", async () => {
    const cdp = new CdpClient({
      endpoint: "http://127.0.0.1:9222",
      fetch: (async () => new Response("{}")) as unknown as typeof globalThis.fetch,
    });

    await expect(cdp.openSession()).rejects.toThrow(CdpError);
  });
});

describe("sessions", () => {
  test("gives each case a browser context of its own", async () => {
    const chrome = new FakeChrome();
    const cdp = client(chrome);

    const session = await openSession(chrome, cdp);

    expect(session).toEqual({ sessionId: "S1", targetId: "T1", browserContextId: "C1" });
    expect(chrome.ofMethod("Target.createTarget")[0]?.params).toMatchObject({
      browserContextId: "C1",
    });
  });

  test("attaches flat, so one socket carries every page", async () => {
    const chrome = new FakeChrome();
    await openSession(chrome, client(chrome));

    expect(chrome.ofMethod("Target.attachToTarget")[0]?.params["flatten"]).toBe(true);
  });

  test("turns on the lifecycle events an SPA's readiness depends on", async () => {
    const chrome = new FakeChrome();
    await openSession(chrome, client(chrome));

    expect(chrome.methodNames()).toContain("Page.setLifecycleEventsEnabled");
  });

  test("releases a frame subscription its subscriber never dropped", async () => {
    // A case that errors disposes its session while the recorder is still
    // subscribed. Without this the per-session frame handler and its map
    // entries outlive the page for the life of the client, and session ids are
    // never reused -- so it grows with every case a long-running server runs.
    // `Page.stopScreencast` is the observable half of that release.
    const chrome = new FakeChrome();
    const cdp = client(chrome);
    const session = await openSession(chrome, cdp);
    await cdp.onFrames(session, () => {});

    await cdp.closeSession(session);

    expect(chrome.ofMethod("Page.stopScreencast")).toHaveLength(1);
  });

  test("stops delivering frames once the session is closed", async () => {
    const chrome = new FakeChrome();
    const cdp = client(chrome);
    const session = await openSession(chrome, cdp);
    const frames: unknown[] = [];
    await cdp.onFrames(session, (frame) => frames.push(frame));

    await cdp.closeSession(session);
    chrome.announceFrame(session.sessionId);

    expect(frames).toHaveLength(0);
  });

  test("disposing the context is what clears cookies and storage together", async () => {
    const chrome = new FakeChrome();
    const cdp = client(chrome);
    const session = await openSession(chrome, cdp);

    await cdp.closeSession(session);

    expect(chrome.ofMethod("Target.disposeBrowserContext")[0]?.params).toEqual({
      browserContextId: "C1",
    });
  });
});

describe("navigation", () => {
  test("waits for the network to go quiet, not merely for load", async () => {
    const chrome = new FakeChrome();
    const cdp = client(chrome);
    const session = await openSession(chrome, cdp);
    chrome.lifecycleOnNavigate = "networkIdle";

    await cdp.navigate(session, "http://x.test/");

    expect(chrome.ofMethod("Page.navigate")[0]?.params["url"]).toBe("http://x.test/");
  });

  test("keeps waiting while the page reports lifecycle events other than idle", async () => {
    const chrome = new FakeChrome();
    const cdp = client(chrome);
    const session = await openSession(chrome, cdp);
    // A page polling on a timer: load fires, networkIdle never does. The wait
    // is bounded at NAVIGATION_TIMEOUT_MS, far past what a test should sit
    // through, so what is pinned here is that `load` alone does not release it.
    chrome.lifecycleOnNavigate = "load";

    let settled = false;
    void cdp.navigate(session, "http://x.test/").then(() => {
      settled = true;
    });
    await Bun.sleep(20);

    expect(settled).toBe(false);
  });

  test("is released by networkIdle, whatever else fired first", async () => {
    const chrome = new FakeChrome();
    const cdp = client(chrome);
    const session = await openSession(chrome, cdp);
    chrome.lifecycleOnNavigate = "load";

    let settled = false;
    void cdp.navigate(session, "http://x.test/").then(() => {
      settled = true;
    });
    await Bun.sleep(10);
    chrome.announceLifecycle("networkIdle", session.sessionId);
    await Bun.sleep(10);

    expect(settled).toBe(true);
  });
});

describe("reading the page", () => {
  test("turns what the collector reported into a tree the serializer renders", async () => {
    const chrome = new FakeChrome();
    const cdp = client(chrome);
    const session = await openSession(chrome, cdp);
    chrome.results["Runtime.evaluate"] = {
      result: {
        value: {
          elements: [
            {
              tag: "button",
              id: "go",
              label: "",
              text: "Continue",
              rect: { x: 0, y: 0, width: 100, height: 40 },
              clickable: true,
              editable: false,
              disabled: false,
              focused: false,
              children: [],
            },
          ],
          roots: [0],
        },
      },
    };

    const tree = await cdp.dumpUi(session);

    expect(tree.className).toBe("button");
    expect(tree.text).toBe("Continue");
    expect(tree.bounds).toEqual({ x1: 0, y1: 0, x2: 100, y2: 40 });
  });

  test("reports a page that threw while being read, rather than a blank screen", async () => {
    const chrome = new FakeChrome();
    const cdp = client(chrome);
    const session = await openSession(chrome, cdp);
    chrome.results["Runtime.evaluate"] = {
      exceptionDetails: { exception: { description: "TypeError: body is null" } },
    };

    await expect(cdp.dumpUi(session)).rejects.toThrow(/TypeError: body is null/);
  });

  test("labels the screen with the path and title", async () => {
    const chrome = new FakeChrome();
    const cdp = client(chrome);
    const session = await openSession(chrome, cdp);
    chrome.results["Runtime.evaluate"] = { result: { value: "/checkout Kexi Coffee Shop" } };

    expect(await cdp.screenLabel(session)).toBe("/checkout Kexi Coffee Shop");
  });
});

describe("input", () => {
  test("presses and releases, because CDP has no click event", async () => {
    const chrome = new FakeChrome();
    const cdp = client(chrome);
    const session = await openSession(chrome, cdp);

    await cdp.tap(session, 60, 40);

    const events = chrome.ofMethod("Input.dispatchMouseEvent");
    expect(events.map((one) => one.params["type"])).toEqual([
      "mouseMoved",
      "mousePressed",
      "mouseReleased",
    ]);
    expect(events[1]?.params).toMatchObject({ x: 60, y: 40, button: "left", clickCount: 1 });
  });

  test("sets clickCount, without which no click is synthesised at all", async () => {
    const chrome = new FakeChrome();
    const cdp = client(chrome);
    const session = await openSession(chrome, cdp);

    await cdp.tap(session, 10, 10);

    for (const event of chrome.ofMethod("Input.dispatchMouseEvent")) {
      expect(event.params["clickCount"]).toBe(1);
    }
  });

  test("inserts text in one go, which fires the input event frameworks listen for", async () => {
    const chrome = new FakeChrome();
    const cdp = client(chrome);
    const session = await openSession(chrome, cdp);

    await cdp.typeText(session, "demo@example.com");

    expect(chrome.ofMethod("Input.insertText")[0]?.params).toEqual({
      text: "demo@example.com",
    });
  });

  test("scrolls with a wheel event, which is instant where a gesture animates", async () => {
    const chrome = new FakeChrome();
    const cdp = client(chrome);
    const session = await openSession(chrome, cdp);
    chrome.results["Runtime.evaluate"] = { result: { value: { width: 1000, height: 800 } } };

    await cdp.swipe(session, "up");

    const wheel = chrome
      .ofMethod("Input.dispatchMouseEvent")
      .find((one) => one.params["type"] === "mouseWheel");
    // Swiping up reveals what is below, so the viewport moves down the page.
    expect(wheel?.params["deltaY"]).toBe(640);
  });

  test("swipes down the other way, so the two are not the same scroll", async () => {
    const chrome = new FakeChrome();
    const cdp = client(chrome);
    const session = await openSession(chrome, cdp);
    chrome.results["Runtime.evaluate"] = { result: { value: { width: 1000, height: 800 } } };

    await cdp.swipe(session, "down");

    const wheel = chrome
      .ofMethod("Input.dispatchMouseEvent")
      .find((one) => one.params["type"] === "mouseWheel");
    expect(wheel?.params["deltaY"]).toBe(-640);
  });

  test("sends Enter with its text, without which a form does not submit", async () => {
    const chrome = new FakeChrome();
    const cdp = client(chrome);
    const session = await openSession(chrome, cdp);

    await cdp.keyevent(session, "enter");

    const keys = chrome.ofMethod("Input.dispatchKeyEvent");
    expect(keys.map((one) => one.params["type"])).toEqual(["keyDown", "keyUp"]);
    expect(keys[0]?.params).toMatchObject({ key: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
  });

  test("reads back as history navigation, which is what back means on a page", async () => {
    const chrome = new FakeChrome();
    const cdp = client(chrome);
    const session = await openSession(chrome, cdp);
    chrome.results["Runtime.evaluate"] = { result: { value: true } };

    const pressed = cdp.keyevent(session, "back");
    await Bun.sleep(10);
    chrome.announceLifecycle("networkIdle", session.sessionId);
    await pressed;

    expect(chrome.ofMethod("Runtime.evaluate")[0]?.params["expression"]).toContain(
      "history.back()",
    );
  });

  test("waits for the page to settle after back, so the next dump is the new one", async () => {
    // history.back() returns the moment it is queued, so without this the step
    // that follows reads the page being left rather than the one arrived at.
    const chrome = new FakeChrome();
    const cdp = client(chrome);
    const session = await openSession(chrome, cdp);
    chrome.results["Runtime.evaluate"] = { result: { value: true } };

    let settled = false;
    void cdp.keyevent(session, "back").then(() => {
      settled = true;
    });
    await Bun.sleep(20);

    expect(settled).toBe(false);

    chrome.announceLifecycle("networkIdle", session.sessionId);
    await Bun.sleep(10);
    expect(settled).toBe(true);
  });

  test("waits for the page to settle after home too", async () => {
    const chrome = new FakeChrome();
    const cdp = client(chrome);
    const session = await openSession(chrome, cdp);
    chrome.results["Runtime.evaluate"] = { result: { value: true } };

    let settled = false;
    void cdp.keyevent(session, "home").then(() => {
      settled = true;
    });
    await Bun.sleep(20);

    expect(settled).toBe(false);

    chrome.announceLifecycle("networkIdle", session.sessionId);
    await Bun.sleep(10);
    expect(settled).toBe(true);
  });

  test("enter needs no settle, being a keystroke rather than a navigation", async () => {
    const chrome = new FakeChrome();
    const cdp = client(chrome);
    const session = await openSession(chrome, cdp);

    // Resolving without any lifecycle event is the assertion.
    await cdp.keyevent(session, "enter");

    expect(chrome.ofMethod("Input.dispatchKeyEvent")).toHaveLength(2);
  });
});

describe("screenshots", () => {
  test("writes the PNG the browser encoded", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cdp-shot-"));
    try {
      const chrome = new FakeChrome();
      const cdp = client(chrome);
      const session = await openSession(chrome, cdp);
      chrome.results["Page.captureScreenshot"] = {
        data: Buffer.from("not really a png").toString("base64"),
      };

      const path = await cdp.screencap(session, join(dir, "000.png"));

      expect(path).toBe(join(dir, "000.png"));
      expect(await Bun.file(path).text()).toBe("not really a png");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("reports a screenshot the browser refused", async () => {
    const chrome = new FakeChrome();
    const cdp = client(chrome);
    const session = await openSession(chrome, cdp);
    chrome.errors["Page.captureScreenshot"] = "Unable to capture screenshot";

    await expect(cdp.screencap(session, "/tmp/never-written.png")).rejects.toThrow(
      /Unable to capture screenshot/,
    );
  });
});

describe("addressing", () => {
  test("tags every page command with its session, so pages cannot be crossed", async () => {
    const chrome = new FakeChrome();
    const cdp = client(chrome);
    const session = await openSession(chrome, cdp);

    await cdp.tap(session, 1, 1);
    await cdp.typeText(session, "x");

    const pageCommands = chrome.sent.filter(
      (one) => one.method.startsWith("Input.") || one.method === "Page.enable",
    );
    for (const command of pageCommands) {
      expect(command.sessionId).toBe("S1");
    }
  });

  test("addresses the browser itself when creating and disposing contexts", async () => {
    const chrome = new FakeChrome();
    const cdp = client(chrome);
    const session = await openSession(chrome, cdp);
    await cdp.closeSession(session);

    for (const method of ["Target.createBrowserContext", "Target.disposeBrowserContext"]) {
      expect(chrome.ofMethod(method)[0]?.sessionId).toBeUndefined();
    }
  });
});
