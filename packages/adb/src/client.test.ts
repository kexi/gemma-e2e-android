import { describe, expect, test } from "bun:test";
import { AdbClient, AdbError, type CommandResult, escapeInputText } from "./client.ts";
import { LOGIN_SCREEN_XML } from "./fixtures.ts";

/** Records argv instead of spawning adb: no device is involved in these tests. */
function recorder(responses: (string | CommandResult)[] = []) {
  const calls: string[][] = [];
  let index = 0;

  const run = async (argv: readonly string[]): Promise<CommandResult> => {
    calls.push([...argv]);
    const next = responses[index++] ?? "";
    const isRawResult = typeof next !== "string";
    return isRawResult ? next : { exitCode: 0, stdout: next, stderr: "" };
  };

  return { calls, run };
}

describe("argv construction", () => {
  test("omits -s when no serial is configured", async () => {
    const { calls, run } = recorder();
    await new AdbClient({ run }).tap(10, 20);
    expect(calls[0]).toEqual(["adb", "shell", "input", "tap", "10", "20"]);
  });

  test("inserts -s <serial> before the subcommand", async () => {
    const { calls, run } = recorder();
    await new AdbClient({ run, serial: "emulator-5554" }).tap(10, 20);
    expect(calls[0]).toEqual(["adb", "-s", "emulator-5554", "shell", "input", "tap", "10", "20"]);
  });

  test("honours a custom adb path", async () => {
    const { calls, run } = recorder();
    await new AdbClient({ run, adbPath: "/nix/store/x/bin/adb" }).tap(1, 2);
    expect(calls[0]?.[0]).toBe("/nix/store/x/bin/adb");
  });

  test("rounds fractional tap coordinates", async () => {
    const { calls, run } = recorder();
    await new AdbClient({ run }).tap(10.4, 20.6);
    expect(calls[0]?.slice(-2)).toEqual(["10", "21"]);
  });
});

describe("devices", () => {
  test("returns only serials in the device state", async () => {
    const { run } = recorder([
      [
        "List of devices attached",
        "emulator-5554\tdevice",
        "R58M12345\tunauthorized",
        "R58M99999\toffline",
        "R58MAAAAA\tdevice",
        "",
      ].join("\n"),
    ]);

    expect(await new AdbClient({ run }).devices()).toEqual(["emulator-5554", "R58MAAAAA"]);
  });

  test("returns an empty list when nothing is attached", async () => {
    const { run } = recorder(["List of devices attached\n\n"]);
    expect(await new AdbClient({ run }).devices()).toEqual([]);
  });
});

describe("dumpUi", () => {
  test("dumps to the device then reads the file back", async () => {
    const { calls, run } = recorder([
      "UI hierchary dumped to: /sdcard/window_dump.xml",
      LOGIN_SCREEN_XML,
    ]);

    const tree = await new AdbClient({ run }).dumpUi();

    expect(calls[0]).toEqual(["adb", "shell", "uiautomator", "dump", "/sdcard/window_dump.xml"]);
    expect(calls[1]).toEqual(["adb", "shell", "cat", "/sdcard/window_dump.xml"]);
    expect(tree.className).toBe("android.widget.FrameLayout");
  });
});

describe("input commands", () => {
  test("typeText escapes spaces as %s", async () => {
    const { calls, run } = recorder();
    await new AdbClient({ run }).typeText("hello world");
    expect(calls[0]?.at(-1)).toBe("hello%sworld");
  });

  test("keyevent maps names to Android keycodes", async () => {
    const { calls, run } = recorder(["", "", ""]);
    const adb = new AdbClient({ run });
    await adb.keyevent("back");
    await adb.keyevent("home");
    await adb.keyevent("enter");
    expect(calls.map((c) => c.at(-1))).toEqual(["KEYCODE_BACK", "KEYCODE_HOME", "KEYCODE_ENTER"]);
  });

  test("swipe up moves the finger from low to high on screen", async () => {
    const { calls, run } = recorder();
    await new AdbClient({ run }).swipe("up", { width: 1000, height: 2000 });
    expect(calls[0]).toEqual([
      "adb",
      "shell",
      "input",
      "swipe",
      "500",
      "1400",
      "500",
      "600",
      "300",
    ]);
  });

  test("swipe left travels right-to-left", async () => {
    const { calls, run } = recorder();
    await new AdbClient({ run }).swipe("left", { width: 1000, height: 2000 });
    const [, , , , x1, , x2] = calls[0] as string[];
    expect(Number(x1)).toBeGreaterThan(Number(x2));
  });
});

describe("escapeInputText", () => {
  test("turns spaces into %s", () => {
    expect(escapeInputText("a b c")).toBe("a%sb%sc");
  });

  test("escapes shell metacharacters the device-side input command would eat", () => {
    expect(escapeInputText("a&b")).toBe("a\\&b");
    expect(escapeInputText("$(x)")).toBe("\\$\\(x\\)");
    expect(escapeInputText("a'b\"c")).toBe("a\\'b\\\"c");
  });

  test("leaves ordinary text and emails untouched", () => {
    expect(escapeInputText("user@example.com")).toBe("user@example.com");
    expect(escapeInputText("hunter2")).toBe("hunter2");
  });
});

describe("app lifecycle", () => {
  test("launchApp without an activity uses monkey", async () => {
    const { calls, run } = recorder();
    await new AdbClient({ run }).launchApp("com.example.app");
    expect(calls[0]).toEqual([
      "adb",
      "shell",
      "monkey",
      "-p",
      "com.example.app",
      "-c",
      "android.intent.category.LAUNCHER",
      "1",
    ]);
  });

  test("launchApp expands a relative activity into a full component", async () => {
    const { calls, run } = recorder();
    await new AdbClient({ run }).launchApp("com.example.app", ".MainActivity");
    expect(calls[0]?.at(-1)).toBe("com.example.app/com.example.app.MainActivity");
  });

  test("launchApp passes an absolute activity through", async () => {
    const { calls, run } = recorder();
    await new AdbClient({ run }).launchApp("com.example.app", "com.other.Activity");
    expect(calls[0]?.at(-1)).toBe("com.example.app/com.other.Activity");
  });

  test("stopApp force-stops the package", async () => {
    const { calls, run } = recorder();
    await new AdbClient({ run }).stopApp("com.example.app");
    expect(calls[0]).toEqual(["adb", "shell", "am", "force-stop", "com.example.app"]);
  });
});

describe("screenSize", () => {
  test("parses wm size output", async () => {
    const { run } = recorder(["Physical size: 1080x2400\n"]);
    expect(await new AdbClient({ run }).screenSize()).toEqual({ width: 1080, height: 2400 });
  });

  test("falls back to a default when the output is unrecognised", async () => {
    const { run } = recorder(["\n"]);
    expect(await new AdbClient({ run }).screenSize()).toEqual({ width: 1080, height: 2400 });
  });
});

describe("failures", () => {
  test("a non-zero exit becomes an AdbError carrying stderr", async () => {
    const { run } = recorder([{ exitCode: 1, stdout: "", stderr: "device not found" }]);
    const promise = new AdbClient({ run }).tap(1, 1);

    await expect(promise).rejects.toBeInstanceOf(AdbError);
    await expect(promise).rejects.toThrow(/device not found/);
  });
});
