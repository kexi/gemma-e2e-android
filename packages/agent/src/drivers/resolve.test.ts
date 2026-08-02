import { describe, expect, test } from "bun:test";
import { FakeAdb, FakeRecorder, LOGIN_XML } from "../fakes.ts";
import { AndroidDriver } from "./android.ts";
import { createDriverResolver } from "./resolve.ts";

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

  test("reports that a web target has no driver in this build", async () => {
    const openDriver = createDriverResolver({ android: { adb: new FakeAdb([LOGIN_XML]) } });

    await expect(openDriver({ platform: "web", url: "http://localhost:5174" })).rejects.toThrow(
      /web targets need a browser/,
    );
  });
});
