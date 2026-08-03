import type { AndroidTarget, KeyName, SwipeDirection, UiNode } from "@gemma-e2e/core";
import type { Driver } from "../driver.ts";

/**
 * The slice of `AdbClient` this adapter drives. Stated here rather than
 * importing the class so the agent package keeps depending on adb for types
 * only, and so a test can supply a fake without a device.
 */
export interface AdbLike {
  dumpUi(): Promise<UiNode>;
  focusedActivity?(): Promise<string>;
  tap(x: number, y: number): Promise<void>;
  typeText(text: string): Promise<void>;
  swipe(direction: SwipeDirection): Promise<void>;
  keyevent(key: KeyName): Promise<void>;
  screencap(destPath: string): Promise<string>;
  launchApp(pkg: string, activity?: string): Promise<void>;
  stopApp(pkg: string): Promise<void>;
}

/**
 * Adapts {@link AdbLike} to {@link Driver}. Holds no logic of its own beyond
 * `reset`: every other method is the adb call under a platform-neutral name,
 * and the client itself is left untouched.
 */
export class AndroidDriver implements Driver {
  readonly #adb: AdbLike;
  readonly #target: AndroidTarget | undefined;

  constructor(adb: AdbLike, target?: AndroidTarget | undefined) {
    this.#adb = adb;
    this.#target = target;
  }

  dumpUi(): Promise<UiNode> {
    return this.#adb.dumpUi();
  }

  async screenLabel(): Promise<string> {
    // Bound before the guard so the narrowing survives the await; a property
    // access is re-widened to optional on every use.
    const report = this.#adb.focusedActivity?.bind(this.#adb);
    const canReport = report !== undefined;
    return canReport ? await report() : "";
  }

  tap(x: number, y: number): Promise<void> {
    return this.#adb.tap(x, y);
  }

  typeText(text: string): Promise<void> {
    return this.#adb.typeText(text);
  }

  swipe(direction: SwipeDirection): Promise<void> {
    return this.#adb.swipe(direction);
  }

  keyevent(key: KeyName): Promise<void> {
    return this.#adb.keyevent(key);
  }

  screencap(destPath: string): Promise<string> {
    return this.#adb.screencap(destPath);
  }

  /**
   * force-stop before launch rather than launch alone: `am start` on a process
   * that is already running resumes whatever screen the previous case left
   * behind, so a case would inherit the last one's navigation stack and login
   * session.
   */
  async reset(): Promise<void> {
    const target = this.#target;
    const hasTarget = target !== undefined;
    if (!hasTarget) {
      return;
    }

    await this.#adb.stopApp(target.package);
    await this.#adb.launchApp(target.package, target.activity);
  }
}
