import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AdbClient,
  AdbError,
  type BinaryCommandResult,
  type CommandResult,
  escapeInputText,
  parseFocusedActivity,
} from "./client.ts";
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
  test("launchApp without an activity resolves the launcher then starts it", async () => {
    const { calls, run } = recorder([
      [
        "priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=false",
        "com.example.app/.MainActivity",
        "",
      ].join("\n"),
    ]);

    await new AdbClient({ run }).launchApp("com.example.app");

    expect(calls[0]).toEqual([
      "adb",
      "shell",
      "cmd",
      "package",
      "resolve-activity",
      "--brief",
      "com.example.app",
    ]);
    expect(calls[1]).toEqual([
      "adb",
      "shell",
      "am",
      "start",
      "-n",
      "com.example.app/.MainActivity",
    ]);
  });

  test("launchApp throws when the package has no launcher activity", async () => {
    const { calls, run } = recorder(["No activity found\n"]);

    await expect(new AdbClient({ run }).launchApp("com.example.app")).rejects.toBeInstanceOf(
      AdbError,
    );
    expect(calls).toHaveLength(1);
  });

  test("launchApp expands a relative activity into a full component", async () => {
    const { calls, run } = recorder();
    await new AdbClient({ run }).launchApp("com.example.app", ".MainActivity");
    expect(calls[0]).toEqual([
      "adb",
      "shell",
      "am",
      "start",
      "-n",
      "com.example.app/com.example.app.MainActivity",
    ]);
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

describe("screencap", () => {
  /**
   * A PNG header followed by bytes that are not valid UTF-8: a lone 0x80
   * continuation, an unpaired surrogate's encoding, and a 0xFF that can never
   * appear in UTF-8. Decoding this to a string replaces each with U+FFFD
   * (`EF BF BD`), which is exactly the corruption being guarded against.
   */
  const PNG_BYTES = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x80, 0xed, 0xa0, 0x80, 0xff, 0xfe, 0xc0, 0x0a, 0x0d, 0x0a, 0x49, 0x45, 0x4e, 0x44,
  ]);

  function binaryRecorder(stdout: Uint8Array) {
    const calls: string[][] = [];
    const runBinary = async (argv: readonly string[]): Promise<BinaryCommandResult> => {
      calls.push([...argv]);
      return { exitCode: 0, stdout, stderr: "" };
    };
    return { calls, runBinary };
  }

  test("uses exec-out so no shell line-ending translation touches the bytes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "adb-screencap-"));
    try {
      const { calls, runBinary } = binaryRecorder(PNG_BYTES);
      await new AdbClient({ runBinary, serial: "emulator-5554" }).screencap(join(dir, "s.png"));
      expect(calls[0]).toEqual(["adb", "-s", "emulator-5554", "exec-out", "screencap", "-p"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("writes the stdout bytes verbatim, without any text decoding", async () => {
    const dir = await mkdtemp(join(tmpdir(), "adb-screencap-"));
    const destPath = join(dir, "shot.png");
    try {
      const { runBinary } = binaryRecorder(PNG_BYTES);

      expect(await new AdbClient({ runBinary }).screencap(destPath)).toBe(destPath);

      const written = new Uint8Array(await readFile(destPath));
      expect(written).toEqual(PNG_BYTES);
      expect(written.slice(0, 4)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
      // Belt and braces: U+FFFD is what a UTF-8 round trip would leave behind.
      expect([...written].join(",")).not.toContain("239,191,189");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a non-zero exit reports stderr rather than writing a file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "adb-screencap-"));
    const destPath = join(dir, "missing.png");
    try {
      const runBinary = async (): Promise<BinaryCommandResult> => ({
        exitCode: 1,
        stdout: new Uint8Array(),
        stderr: "device offline",
      });

      const promise = new AdbClient({ runBinary }).screencap(destPath);
      await expect(promise).rejects.toBeInstanceOf(AdbError);
      await expect(promise).rejects.toThrow(/device offline/);
      expect(await Bun.file(destPath).exists()).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("focusedActivity", () => {
  /** Shape of `dumpsys window displays` on the project's API 35 emulator. */
  const DISPLAYS = [
    "WINDOW MANAGER DISPLAY CONTENTS (dumpsys window displays)",
    "  Display: mDisplayId=0",
    "  mCurrentFocus=Window{ba22b58 u0 dev.kexi.gemmae2e.example/dev.kexi.gemmae2e.example.MainActivity}",
    "  mFocusedApp=ActivityRecord{a1bd6b5 u0 dev.kexi.gemmae2e.example/.MainActivity t28}",
    "",
  ].join("\n");

  test("asks the displays subcommand rather than dumping all of window manager", async () => {
    const { calls, run } = recorder([DISPLAYS]);
    await new AdbClient({ run }).focusedActivity();
    expect(calls[0]).toEqual(["adb", "shell", "dumpsys", "window", "displays"]);
  });

  test("names the focused activity relative to its package", async () => {
    const { run } = recorder([DISPLAYS]);
    expect(await new AdbClient({ run }).focusedActivity()).toBe(".MainActivity");
  });

  test("falls back to mFocusedApp while a transition leaves mCurrentFocus null", () => {
    const midTransition = [
      "  mCurrentFocus=null",
      "  mFocusedApp=ActivityRecord{a1 u0 com.example.app/.DetailActivity t7}",
    ].join("\n");

    expect(parseFocusedActivity(midTransition)).toBe(".DetailActivity");
  });

  /**
   * The project's own emulator does exactly this: a secondary display reports
   * no focus, and reading only the first matching line found nothing at all.
   */
  test("skips a display that reports no focus and takes the one that does", () => {
    const twoDisplays = [
      "  Display: mDisplayId=2",
      "  mCurrentFocus=null",
      "  Display: mDisplayId=0",
      "  mCurrentFocus=Window{88e8cea u0 com.example.app/com.example.app.MainActivity}",
    ].join("\n");

    expect(parseFocusedActivity(twoDisplays)).toBe(".MainActivity");
  });

  test("keeps an activity that lives outside the package it runs in", () => {
    const external = "  mCurrentFocus=Window{a1 u0 com.example.app/androidx.compose.HostActivity}";
    expect(parseFocusedActivity(external)).toBe("androidx.compose.HostActivity");
  });

  test("returns an empty signature when neither line names a component", () => {
    expect(parseFocusedActivity("  mCurrentFocus=null\n  mFocusedApp=null")).toBe("");
    expect(parseFocusedActivity("")).toBe("");
  });

  test("reports nothing rather than throwing when the device refuses the call", async () => {
    const { run } = recorder([{ exitCode: 1, stdout: "", stderr: "device offline" }]);
    expect(await new AdbClient({ run }).focusedActivity()).toBe("");
  });
});

describe("failures", () => {
  test("a non-zero exit becomes an AdbError carrying stderr", async () => {
    const { run } = recorder([{ exitCode: 1, stdout: "", stderr: "device not found" }]);
    const promise = new AdbClient({ run }).tap(1, 1);

    await expect(promise).rejects.toBeInstanceOf(AdbError);
    await expect(promise).rejects.toThrow(/device not found/);
  });

  test("names the command once, without doubling the adb binary", async () => {
    const { run } = recorder([{ exitCode: 1, stdout: "", stderr: "device not found" }]);
    const promise = new AdbClient({ run }).tap(1, 1);

    await expect(promise).rejects.toThrow(/^adb shell input tap 1 1 failed/);
  });

  test("keeps a custom adb path in the message", async () => {
    const { run } = recorder([{ exitCode: 1, stdout: "", stderr: "boom" }]);
    const promise = new AdbClient({ run, adbPath: "/opt/adb" }).tap(1, 1);

    await expect(promise).rejects.toThrow(/^\/opt\/adb shell input tap 1 1 failed/);
  });
});
