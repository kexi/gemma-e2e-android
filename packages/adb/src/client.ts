import type { KeyName, SwipeDirection, UiNode } from "@gemma-e2e/core";
import { errorFields, type Logger, noopLogger } from "@gemma-e2e/logger";
import { parseUiDump } from "./parse.ts";

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * A command whose stdout is arbitrary bytes. Kept separate from
 * {@link CommandResult} rather than widening `stdout` to a union, so every
 * text-oriented caller keeps a plain `string` and cannot accidentally receive
 * bytes it would have to narrow.
 */
export interface BinaryCommandResult {
  exitCode: number;
  stdout: Uint8Array;
  stderr: string;
}

/** Injection seam: tests substitute a recorder, production uses Bun.spawn. */
export type CommandRunner = (
  argv: readonly string[],
  options: { timeoutMs: number },
) => Promise<CommandResult>;

/** The {@link CommandRunner} seam for commands that emit binary stdout. */
export type BinaryCommandRunner = (
  argv: readonly string[],
  options: { timeoutMs: number },
) => Promise<BinaryCommandResult>;

export interface AdbClientOptions {
  serial?: string | undefined;
  adbPath?: string | undefined;
  timeoutMs?: number | undefined;
  run?: CommandRunner | undefined;
  /** Binary-stdout seam, used by `screencap`; defaults alongside `run`. */
  runBinary?: BinaryCommandRunner | undefined;
  /** Defaults to a no-op, so importing the client never writes on its own. */
  logger?: Logger | undefined;
}

export class AdbError extends Error {
  override readonly name = "AdbError";

  constructor(
    readonly argv: readonly string[],
    readonly result: CommandResult | BinaryCommandResult,
  ) {
    // A binary command that failed prints a diagnostic rather than the payload,
    // so decoding its stdout for the message is safe; the bytes are only kept
    // undecoded on the success path, where they are the file being written.
    const stdout =
      typeof result.stdout === "string" ? result.stdout : new TextDecoder().decode(result.stdout);
    super(
      `adb ${argv.join(" ")} failed (exit ${result.exitCode}): ${
        result.stderr.trim() || stdout.trim()
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

/**
 * Spawns `argv`, killing it after `timeoutMs`, and hands stdout to `collect`.
 * `stdout: "pipe"` guarantees a stream, but Bun's overload-free signature types
 * it as the union of every mode, so the cast states what the options already
 * fix.
 */
async function spawnAndCollect<T>(
  argv: readonly string[],
  timeoutMs: number,
  collect: (stdout: ReadableStream<Uint8Array>) => Promise<T>,
): Promise<{ exitCode: number; stdout: T; stderr: string }> {
  const proc = Bun.spawn([...argv], { stdout: "pipe", stderr: "pipe" });

  const timer = setTimeout(() => {
    proc.kill();
  }, timeoutMs);

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      collect(proc.stdout as ReadableStream<Uint8Array>),
      new Response(proc.stderr as ReadableStream<Uint8Array>).text(),
      proc.exited,
    ]);
    return { exitCode, stdout, stderr };
  } finally {
    clearTimeout(timer);
  }
}

const defaultRunner: CommandRunner = async (argv, { timeoutMs }) =>
  await spawnAndCollect(argv, timeoutMs, async (stdout) => await new Response(stdout).text());

/**
 * Reads stdout as raw bytes. `.text()` would decode as UTF-8 and replace every
 * byte that is not valid UTF-8 with U+FFFD — which silently corrupts a PNG,
 * starting with its own `89 50 4E 47` magic.
 */
const defaultBinaryRunner: BinaryCommandRunner = async (argv, { timeoutMs }) =>
  await spawnAndCollect(
    argv,
    timeoutMs,
    async (stdout) => new Uint8Array(await new Response(stdout).arrayBuffer()),
  );

export class AdbClient {
  readonly #serial: string | undefined;
  readonly #adbPath: string;
  readonly #timeoutMs: number;
  readonly #run: CommandRunner;
  readonly #runBinary: BinaryCommandRunner;
  readonly #log: Logger;

  constructor(options: AdbClientOptions = {}) {
    this.#serial = options.serial;
    this.#adbPath = options.adbPath ?? "adb";
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#run = options.run ?? defaultRunner;
    this.#runBinary = options.runBinary ?? defaultBinaryRunner;
    this.#log = options.logger ?? noopLogger;
  }

  /**
   * Logs a failed command and returns the error to throw. Only failures are
   * logged: a run issues an adb call per step per action, and recording the
   * successful ones would bury the one line that explains a broken run.
   */
  #fail(argv: readonly string[], result: CommandResult | BinaryCommandResult): AdbError {
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

  /**
   * Writes a PNG screenshot to `destPath`, byte for byte.
   *
   * Why not `adb shell screencap -p`: the shell allocates a pty on some
   * transports and translates LF into CRLF, which rewrites any 0x0A inside the
   * compressed image data. `exec-out` is a raw stream with no such translation.
   *
   * Why the bytes are never turned into a string: PNG is not text, and any
   * decode step — even a round trip through UTF-8 — destroys it.
   */
  async screencap(destPath: string): Promise<string> {
    const argv = this.buildArgv(["exec-out", "screencap", "-p"]);
    const result = await this.#runBinary(argv, { timeoutMs: this.#timeoutMs });

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
