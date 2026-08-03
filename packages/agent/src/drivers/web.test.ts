import { describe, expect, test } from "bun:test";
import { serializeForLlm } from "@gemma-e2e/core";
import { FakeCdp } from "../fakes.ts";
import { WebDriver } from "./web.ts";

const SESSION = { sessionId: "S1", targetId: "T1", browserContextId: "C1" };
const TARGET = { platform: "web", url: "http://localhost:5174" } as const;

function driver(cdp: FakeCdp): WebDriver {
  return new WebDriver(cdp, SESSION, TARGET);
}

describe("WebDriver", () => {
  test("navigates to the target's url on reset", async () => {
    const cdp = new FakeCdp();

    await driver(cdp).reset();

    expect(cdp.calls).toEqual([{ method: "navigate", args: ["S1", "http://localhost:5174"] }]);
  });

  test("clears nothing on reset, because the context was already fresh", async () => {
    // Where android has to force-stop before launching, a context created for
    // this case alone starts with no cookies and no storage. A reset that also
    // tried to clear would be doing work the isolation already did.
    const cdp = new FakeCdp();

    await driver(cdp).reset();

    expect(cdp.calls.map((call) => call.method)).toEqual(["navigate"]);
  });

  test("passes every other call straight through", async () => {
    const cdp = new FakeCdp();
    const web = driver(cdp);

    await web.tap(10, 20);
    await web.typeText("hunter2");
    await web.swipe("up");
    await web.keyevent("back");
    await web.screencap("/tmp/shot.png");

    expect(cdp.calls).toEqual([
      { method: "tap", args: [10, 20] },
      { method: "typeText", args: ["hunter2"] },
      { method: "swipe", args: ["up"] },
      { method: "keyevent", args: ["back"] },
      { method: "screencap", args: ["/tmp/shot.png"] },
    ]);
  });

  test("labels the screen with what the page reports", async () => {
    const cdp = new FakeCdp();
    cdp.label = "/checkout Kexi Coffee Shop";

    expect(await driver(cdp).screenLabel()).toBe("/checkout Kexi Coffee Shop");
  });

  test("hands the loop a tree the shared serializer renders", async () => {
    // The whole point of the adapter: what comes back is the same shape the
    // android driver produces, so the numbering below is the same code.
    const cdp = new FakeCdp();

    const { text, refs } = serializeForLlm(await driver(cdp).dumpUi());

    expect(refs.size).toBeGreaterThan(0);
    expect(text).toContain("[0]");
  });

  test("does not dispose the session it was handed", async () => {
    // Closing belongs to whoever opened it -- the resolver -- because the
    // session outlives any single call and the driver never sees the case end.
    const cdp = new FakeCdp();
    const web = driver(cdp);

    await web.reset();
    await web.tap(1, 1);

    expect(cdp.closed).toEqual([]);
  });
});
