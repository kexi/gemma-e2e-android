import { describe, expect, test } from "bun:test";
import { FakeAdb, LOGIN_XML } from "../fakes.ts";
import { AndroidDriver } from "./android.ts";

describe("AndroidDriver", () => {
  test("force-stops before launching, so a case starts clean", async () => {
    const adb = new FakeAdb([LOGIN_XML]);
    const driver = new AndroidDriver(adb, {
      platform: "android",
      package: "com.example.app",
      activity: ".MainActivity",
    });

    await driver.reset();

    expect(adb.calls).toEqual([
      { method: "stopApp", args: ["com.example.app"] },
      { method: "launchApp", args: ["com.example.app", ".MainActivity"] },
    ]);
  });

  test("resetting with no target touches the device at all", async () => {
    const adb = new FakeAdb([LOGIN_XML]);

    await new AndroidDriver(adb).reset();

    expect(adb.calls).toEqual([]);
  });

  test("passes every other call straight through", async () => {
    const adb = new FakeAdb([LOGIN_XML]);
    const driver = new AndroidDriver(adb);

    await driver.tap(10, 20);
    await driver.typeText("hunter2");
    await driver.swipe("up");
    await driver.keyevent("back");
    await driver.screencap("/tmp/shot.png");

    expect(adb.calls).toEqual([
      { method: "tap", args: [10, 20] },
      { method: "typeText", args: ["hunter2"] },
      { method: "swipe", args: ["up"] },
      { method: "keyevent", args: ["back"] },
      { method: "screencap", args: ["/tmp/shot.png"] },
    ]);
  });

  test("labels the screen with the focused activity", async () => {
    const adb = new FakeAdb([LOGIN_XML]);
    adb.activities = [".LoginActivity"];

    expect(await new AndroidDriver(adb).screenLabel()).toBe(".LoginActivity");
  });

  test("reports no label when the client cannot name an activity", async () => {
    const adb = new FakeAdb([LOGIN_XML]);
    // A client predating focusedActivity: the method is absent, not empty.
    const { focusedActivity: _omitted, ...withoutReporting } = adb;
    const driver = new AndroidDriver({
      ...withoutReporting,
      dumpUi: () => adb.dumpUi(),
      tap: (x, y) => adb.tap(x, y),
      typeText: (text) => adb.typeText(text),
      swipe: (direction) => adb.swipe(direction),
      keyevent: (key) => adb.keyevent(key),
      screencap: (destPath) => adb.screencap(destPath),
      launchApp: (pkg, activity) => adb.launchApp(pkg, activity),
      stopApp: (pkg) => adb.stopApp(pkg),
    });

    expect(await driver.screenLabel()).toBe("");
  });
});
