import { describe, expect, test } from "bun:test";
import { FakeAdb, FakeCdp, FakeRecorder, LOGIN_XML } from "../fakes.ts";
import type { Recorder } from "../recorder.ts";
import { AndroidDriver } from "./android.ts";
import { createDriverResolver } from "./resolve.ts";
import { WebDriver } from "./web.ts";

describe("createDriverResolver", () => {
  test("opens the android driver for an android target", async () => {
    const adb = new FakeAdb([LOGIN_XML]);
    const openDriver = createDriverResolver({ android: { adb } });

    const session = await openDriver({
      platform: "android",
      package: "com.example.app",
    });

    expect(session.driver).toBeInstanceOf(AndroidDriver);
    await session.driver.reset();
    expect(adb.methodNames()).toEqual(["stopApp", "launchApp"]);
  });

  test("hands the android session its recorder, so the case is filmed", async () => {
    const recorder = new FakeRecorder();
    const openDriver = createDriverResolver({
      android: { adb: new FakeAdb([LOGIN_XML]), recorder },
    });

    const session = await openDriver({ platform: "android", package: "com.example.app" });

    expect(session.recorder).toBe(recorder);
  });

  test("leaves the recorder off when none is configured", async () => {
    const openDriver = createDriverResolver({ android: { adb: new FakeAdb([LOGIN_XML]) } });

    const session = await openDriver({ platform: "android", package: "com.example.app" });

    expect(session.recorder).toBeUndefined();
  });

  test("drives whatever is on screen when the case names no target", async () => {
    const adb = new FakeAdb([LOGIN_XML]);
    const openDriver = createDriverResolver({ android: { adb } });

    const session = await openDriver(undefined);
    await session.driver.reset();

    // No package to stop or launch, so a reset must leave the device alone
    // rather than guess at one.
    expect(adb.calls).toEqual([]);
  });

  test("closing an android session releases nothing, because it shares the client", async () => {
    const adb = new FakeAdb([LOGIN_XML]);
    const openDriver = createDriverResolver({ android: { adb } });

    const session = await openDriver({ platform: "android", package: "com.example.app" });
    await session.close();

    expect(adb.calls).toEqual([]);
  });

  test("reports a web target when no browser is wired into this build", async () => {
    const openDriver = createDriverResolver({ android: { adb: new FakeAdb([LOGIN_XML]) } });

    await expect(openDriver({ platform: "web", url: "http://localhost:5174" })).rejects.toThrow(
      /no browser wired in/,
    );
  });
});

describe("createDriverResolver: web", () => {
  const WEB_TARGET = { platform: "web", url: "http://localhost:5174" } as const;

  function resolver(cdp: FakeCdp, recorder?: (session: { sessionId: string }) => Recorder) {
    return createDriverResolver({
      android: { adb: new FakeAdb([LOGIN_XML]) },
      web: { cdp, ...(recorder === undefined ? {} : { recorder }) },
    });
  }

  test("opens the web driver for a web target", async () => {
    const cdp = new FakeCdp();

    const session = await resolver(cdp)(WEB_TARGET);

    expect(session.driver).toBeInstanceOf(WebDriver);
    expect(cdp.opened).toBe(1);
  });

  test("navigates to the target's url on reset", async () => {
    const cdp = new FakeCdp();

    const session = await resolver(cdp)(WEB_TARGET);
    await session.driver.reset();

    expect(cdp.calls).toContainEqual({
      method: "navigate",
      args: ["S1", "http://localhost:5174"],
    });
  });

  test("passes the target's viewport through, so a case can size the page", async () => {
    const cdp = new FakeCdp();

    await resolver(cdp)({ ...WEB_TARGET, viewport: { width: 390, height: 844 } });

    expect(cdp.calls[0]).toEqual({
      method: "openSession",
      args: [{ width: 390, height: 844 }],
    });
  });

  test("closing disposes the context, which is what isolates one case from the next", async () => {
    const cdp = new FakeCdp();

    const session = await resolver(cdp)(WEB_TARGET);
    await session.close();

    expect(cdp.closed).toEqual(["S1"]);
  });

  test("builds the recorder per session, since a screencast belongs to one page", async () => {
    const cdp = new FakeCdp();
    const built: string[] = [];
    const recorder = (session: { sessionId: string }) => {
      built.push(session.sessionId);
      return new FakeRecorder();
    };

    const first = await resolver(cdp, recorder)(WEB_TARGET);
    await first.close();
    const second = await resolver(cdp, recorder)(WEB_TARGET);

    expect(built).toEqual(["S1", "S2"]);
    expect(second.recorder).toBeDefined();
  });

  test("leaves the recorder off when none is configured", async () => {
    const session = await resolver(new FakeCdp())(WEB_TARGET);

    expect(session.recorder).toBeUndefined();
  });
});
