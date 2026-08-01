import type { KeyName, SwipeDirection, UiNode } from "@gemma-e2e/core";
import { errorFields, type Logger, noopLogger } from "@gemma-e2e/logger";
import { parseUiDump } from "./parse.ts";

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Injection seam: tests substitute a recorder, production uses Bun.spawn. */
export type CommandRunner = (
  argv: readonly string[],
  options: { timeoutMs: number },
) => Promise<CommandResult>;

export interface AdbClientOptions {
  serial?: string | undefined;
  adbPath?: string | undefined;
  timeoutMs?: number | undefined;
  run?: CommandRunner | undefined;
  /** Defaults to a no-op, so importing the client never writes on its own. */
  logger?: Logger | undefined;
}

export class AdbError extends Error {
  override readonly name = "AdbError";

  constructor(
    readonly argv: readonly string[],
    readonly result: CommandResult,
  ) {
    super(
      `adb ${argv.join(" ")} failed (exit ${result.exitCode}): ${
        result.stderr.trim() || result.stdout.trim()
      }`,
    );
  }
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEVICE_UI_DUMP_PATH = "/sdcard/window_dump.xml";

const KEYCODES: Record<KeyName, string> = {
  back: "KEYCODE_BACK",
  home: "KEYCODE_HOME",
  enter: "KEYCODE_ENTER",
};

/** Swipe as a fraction of screen size, so it works on any display. */
const SWIPE_VECTORS: Record<SwipeDirection, { x1: number; y1: number; x2: number; y2: number }> = {
  // A swipe "up" moves content up, so the finger travels from low on the
  // screen toward the top.
  up: { x1: 0.5, y1: 0.7, x2: 0.5, y2: 0.3 },
  down: { x1: 0.5, y1: 0.3, x2: 0.5, y2: 0.7 },
  left: { x1: 0.8, y1: 0.5, x2: 0.2, y2: 0.5 },
  right: { x1: 0.2, y1: 0.5, x2: 0.8, y2: 0.5 },
};

const DEFAULT_SCREEN = { width: 1080, height: 2400 };

/**
 * `adb shell input text` runs through a shell word-splitter: spaces separate
 * arguments unless sent as %s, and the listed metacharacters would otherwise be
 * interpreted. Escaping here rather than quoting the whole string is what the
 * platform's own input command expects.
 */
export function escapeInputText(text: string): string {
  return text.replace(/([\\()<>|;&*~"'`$\][?{}#])/g, "\\$1").replace(/ /g, "%s");
}

const defaultRunner: CommandRunner = async (argv, { timeoutMs }) => {
  const proc = Bun.spawn([...argv], { stdout: "pipe", stderr: "pipe" });

  const timer = setTimeout(() => {
    proc.kill();
  }, timeoutMs);

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { exitCode, stdout, stderr };
  } finally {
    clearTimeout(timer);
  }
};

export class AdbClient {
  readonly #serial: string | undefined;
  readonly #adbPath: string;
  readonly #timeoutMs: number;
  readonly #run: CommandRunner;
  readonly #log: Logger;

  constructor(options: AdbClientOptions = {}) {
    this.#serial = options.serial;
    this.#adbPath = options.adbPath ?? "adb";
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#run = options.run ?? defaultRunner;
    this.#log = options.logger ?? noopLogger;
  }

  /**
   * Logs a failed command and returns the error to throw. Only failures are
   * logged: a run issues an adb call per step per action, and recording the
   * successful ones would bury the one line that explains a broken run.
   */
  #fail(argv: readonly string[], result: CommandResult): AdbError {
    const error = new AdbError(argv, result);
    this.#log.error("adb.exec_failed", {
      argv: [...argv],
      exitCode: result.exitCode,
      stderr: result.stderr.trim(),
      ...errorFields(error),
    });
    return error;
  }

  /** Full argv for a command, with `-s <serial>` inserted when targeting one device. */
  buildArgv(args: readonly string[]): string[] {
    const serialFlag = this.#serial === undefined ? [] : ["-s", this.#serial];
    return [this.#adbPath, ...serialFlag, ...args];
  }

  async exec(args: readonly string[]): Promise<string> {
    const argv = this.buildArgv(args);
    const result = await this.#run(argv, { timeoutMs: this.#timeoutMs });

    const failed = result.exitCode !== 0;
    if (failed) {
      throw this.#fail(argv, result);
    }

    return result.stdout;
  }

  /** Serials of devices in the `device` state; offline/unauthorized are skipped. */
  async devices(): Promise<string[]> {
    const stdout = await this.exec(["devices"]);

    return stdout
      .split("\n")
      .slice(1)
      .map((line) => line.trim())
      .filter((line) => line !== "")
      .map((line) => line.split(/\s+/))
      .filter((columns) => columns[1] === "device")
      .map((columns) => columns[0] as string);
  }

  /**
   * Dumps the UI tree. uiautomator writes to the device filesystem and prints
   * only a status line, so the XML comes back via a second `cat`.
   */
  async dumpUi(): Promise<UiNode> {
    return parseUiDump(await this.dumpUiXml());
  }

  async dumpUiXml(): Promise<string> {
    await this.exec(["shell", "uiautomator", "dump", DEVICE_UI_DUMP_PATH]);
    return await this.exec(["shell", "cat", DEVICE_UI_DUMP_PATH]);
  }

  /** `exec-out` keeps the PNG bytes off the shell's line-ending translation. */
  async screencap(destPath: string): Promise<string> {
    const argv = this.buildArgv(["exec-out", "screencap", "-p"]);
    const result = await this.#run(argv, { timeoutMs: this.#timeoutMs });

    const failed = result.exitCode !== 0;
    if (failed) {
      throw this.#fail(argv, result);
    }

    await Bun.write(destPath, result.stdout);
    return destPath;
  }

  async tap(x: number, y: number): Promise<void> {
    await this.exec(["shell", "input", "tap", String(Math.round(x)), String(Math.round(y))]);
  }

  async swipe(
    direction: SwipeDirection,
    screen: { width: number; height: number } = DEFAULT_SCREEN,
    durationMs = 300,
  ): Promise<void> {
    const vector = SWIPE_VECTORS[direction];
    await this.exec([
      "shell",
      "input",
      "swipe",
      String(Math.round(vector.x1 * screen.width)),
      String(Math.round(vector.y1 * screen.height)),
      String(Math.round(vector.x2 * screen.width)),
      String(Math.round(vector.y2 * screen.height)),
      String(durationMs),
    ]);
  }

  async typeText(text: string): Promise<void> {
    await this.exec(["shell", "input", "text", escapeInputText(text)]);
  }

  async keyevent(key: KeyName): Promise<void> {
    await this.exec(["shell", "input", "keyevent", KEYCODES[key]]);
  }

  /**
   * Launches by package, or by explicit component when an activity is given.
   * `monkey` is the reliable way to start an app whose launcher activity is not
   * known; `am start` is used when the caller names the component.
   */
  async launchApp(pkg: string, activity?: string): Promise<void> {
    const hasActivity = activity !== undefined;
    if (hasActivity) {
      const component = activity.startsWith(".")
        ? `${pkg}/${pkg}${activity}`
        : `${pkg}/${activity}`;
      await this.exec(["shell", "am", "start", "-n", component]);
      return;
    }

    await this.exec(["shell", "monkey", "-p", pkg, "-c", "android.intent.category.LAUNCHER", "1"]);
  }

  async stopApp(pkg: string): Promise<void> {
    await this.exec(["shell", "am", "force-stop", pkg]);
  }

  /** Screen size in pixels, for turning fractional swipe vectors into coordinates. */
  async screenSize(): Promise<{ width: number; height: number }> {
    const stdout = await this.exec(["shell", "wm", "size"]);
    const match = /(\d+)x(\d+)/.exec(stdout);
    if (!match) {
      return DEFAULT_SCREEN;
    }
    return { width: Number(match[1]), height: Number(match[2]) };
  }
}
