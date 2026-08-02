import { describe, expect, test } from "bun:test";
import { CdpConnection, CdpError, type SocketLike } from "./connection.ts";

/**
 * A socket that records what was sent and lets a test answer it. Stands in for
 * Chrome, so the protocol -- id matching, session routing, error replies,
 * timeouts -- is exercised without a browser.
 */
class FakeSocket implements SocketLike {
  readonly sent: Record<string, unknown>[] = [];
  closed = false;
  readonly readyState = 1;

  #onMessage: ((event: { data: unknown }) => void) | undefined;
  #onClose: (() => void) | undefined;
  #onError: ((event: unknown) => void) | undefined;

  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }

  close(): void {
    this.closed = true;
  }

  addEventListener(type: string, handler: (event: never) => void): void {
    if (type === "message") this.#onMessage = handler as (event: { data: unknown }) => void;
    if (type === "close") this.#onClose = handler as () => void;
    if (type === "error") this.#onError = handler as (event: unknown) => void;
  }

  /** Delivers a frame as Chrome would. */
  deliver(message: unknown): void {
    this.#onMessage?.({ data: JSON.stringify(message) });
  }

  /** Delivers a frame verbatim, for the cases that are not valid JSON. */
  deliverRaw(data: unknown): void {
    this.#onMessage?.({ data });
  }

  drop(): void {
    this.#onClose?.();
  }

  fail(reason: unknown): void {
    this.#onError?.(reason);
  }

  /** The id Chrome would echo back for the nth command sent. */
  idOf(index: number): number {
    return this.sent[index]?.["id"] as number;
  }
}

async function connect(socket: FakeSocket, timeoutMs?: number): Promise<CdpConnection> {
  return await CdpConnection.open("ws://test", {
    socket: () => socket,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
}

describe("CdpConnection commands", () => {
  test("sends a command and resolves with its result", async () => {
    const socket = new FakeSocket();
    const cdp = await connect(socket);

    const pending = cdp.send("Page.navigate", { url: "http://x.test" });
    socket.deliver({ id: socket.idOf(0), result: { frameId: "F1" } });

    expect(await pending).toEqual({ frameId: "F1" });
    expect(socket.sent[0]).toMatchObject({
      method: "Page.navigate",
      params: { url: "http://x.test" },
    });
  });

  test("routes a command to a session, which is how a page is addressed", async () => {
    const socket = new FakeSocket();
    const cdp = await connect(socket);

    void cdp.send("Runtime.evaluate", { expression: "1" }, "S1");

    expect(socket.sent[0]?.["sessionId"]).toBe("S1");
  });

  test("omits sessionId for browser-level commands", async () => {
    const socket = new FakeSocket();
    const cdp = await connect(socket);

    void cdp.send("Target.createBrowserContext");

    expect(socket.sent[0]).not.toHaveProperty("sessionId");
  });

  test("matches replies by id, so answers may arrive out of order", async () => {
    const socket = new FakeSocket();
    const cdp = await connect(socket);

    const first = cdp.send("A");
    const second = cdp.send("B");
    socket.deliver({ id: socket.idOf(1), result: { which: "B" } });
    socket.deliver({ id: socket.idOf(0), result: { which: "A" } });

    expect(await first).toEqual({ which: "A" });
    expect(await second).toEqual({ which: "B" });
  });

  test("rejects with the protocol error, naming the command that failed", async () => {
    const socket = new FakeSocket();
    const cdp = await connect(socket);

    const pending = cdp.send("DOM.focus");
    socket.deliver({
      id: socket.idOf(0),
      error: { code: -32000, message: "Node is not focusable" },
    });

    await expect(pending).rejects.toThrow(/DOM\.focus failed: Node is not focusable/);
  });

  test("resolves to an empty result when a command answers with none", async () => {
    const socket = new FakeSocket();
    const cdp = await connect(socket);

    const pending = cdp.send("Page.enable");
    socket.deliver({ id: socket.idOf(0) });

    expect(await pending).toEqual({});
  });

  test("gives up on a command that is never answered", async () => {
    const socket = new FakeSocket();
    const cdp = await connect(socket, 10);

    await expect(cdp.send("Page.navigate")).rejects.toThrow(/did not answer within 10ms/);
  });

  test("ignores a reply that arrives after its command gave up", async () => {
    const socket = new FakeSocket();
    const cdp = await connect(socket, 10);

    await expect(cdp.send("Page.navigate")).rejects.toThrow(CdpError);
    // Nothing is waiting for this any more; delivering it must not throw.
    expect(() => socket.deliver({ id: socket.idOf(0), result: {} })).not.toThrow();
  });
});

describe("CdpConnection events", () => {
  test("delivers an event to its subscriber", async () => {
    const socket = new FakeSocket();
    const cdp = await connect(socket);
    const seen: unknown[] = [];
    cdp.on("Page.loadEventFired", (event) => seen.push(event.params));

    socket.deliver({ method: "Page.loadEventFired", params: { timestamp: 12 } });

    expect(seen).toEqual([{ timestamp: 12 }]);
  });

  test("carries the session an event came from, so frames can be told apart", async () => {
    const socket = new FakeSocket();
    const cdp = await connect(socket);
    const sessions: (string | undefined)[] = [];
    cdp.on("Page.screencastFrame", (event) => sessions.push(event.sessionId));

    socket.deliver({ method: "Page.screencastFrame", params: {}, sessionId: "S1" });
    socket.deliver({ method: "Page.screencastFrame", params: {} });

    expect(sessions).toEqual(["S1", undefined]);
  });

  test("stops delivering once a subscriber unsubscribes", async () => {
    const socket = new FakeSocket();
    const cdp = await connect(socket);
    let count = 0;
    const off = cdp.on("Page.loadEventFired", () => {
      count += 1;
    });

    socket.deliver({ method: "Page.loadEventFired", params: {} });
    off();
    socket.deliver({ method: "Page.loadEventFired", params: {} });

    expect(count).toBe(1);
  });

  test("lets a handler unsubscribe itself mid-dispatch", async () => {
    // What the screencast fan-out does when its last client leaves: the set is
    // mutated while it is being iterated.
    const socket = new FakeSocket();
    const cdp = await connect(socket);
    const seen: string[] = [];
    const off = cdp.on("E", () => {
      seen.push("first");
      off();
    });
    cdp.on("E", () => seen.push("second"));

    socket.deliver({ method: "E", params: {} });

    expect(seen).toEqual(["first", "second"]);
  });

  test("keeps delivering to the others when one subscriber throws", async () => {
    const socket = new FakeSocket();
    const cdp = await connect(socket);
    const seen: string[] = [];
    cdp.on("E", () => {
      throw new Error("subscriber is broken");
    });
    cdp.on("E", () => seen.push("reached"));

    expect(() => socket.deliver({ method: "E", params: {} })).not.toThrow();
    expect(seen).toEqual(["reached"]);
  });

  test("survives a frame that is not JSON at all", async () => {
    const socket = new FakeSocket();
    const cdp = await connect(socket);
    cdp.on("E", () => {});

    expect(() => socket.deliverRaw("<html>proxy error</html>")).not.toThrow();
    expect(() => socket.deliverRaw(new Uint8Array([1, 2]))).not.toThrow();
  });
});

describe("CdpConnection teardown", () => {
  test("fails everything in flight when the socket drops", async () => {
    const socket = new FakeSocket();
    const cdp = await connect(socket);

    const pending = cdp.send("Page.navigate");
    socket.drop();

    await expect(pending).rejects.toThrow(/connection closed/);
  });

  test("fails everything in flight when the socket errors", async () => {
    const socket = new FakeSocket();
    const cdp = await connect(socket);

    const pending = cdp.send("Page.navigate");
    socket.fail(new Error("ECONNRESET"));

    await expect(pending).rejects.toThrow(/ECONNRESET/);
  });

  test("refuses new commands once closed, rather than hanging until the timeout", async () => {
    const socket = new FakeSocket();
    const cdp = await connect(socket);

    cdp.close();

    expect(socket.closed).toBe(true);
    await expect(cdp.send("Page.navigate")).rejects.toThrow(CdpError);
  });
});
