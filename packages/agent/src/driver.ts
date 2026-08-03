import type { KeyName, SwipeDirection, Target, UiNode } from "@gemma-e2e/core";
import type { Recorder } from "./recorder.ts";

/**
 * Everything the agent loop does to the thing under test, in terms that hold
 * for a phone and for a browser alike.
 *
 * Deliberately narrow: the loop perceives a tree, acts once, and captures a
 * frame. Anything a platform can do beyond that -- clearing app data, mocking
 * a request -- belongs behind {@link Driver.reset} or not in this interface at
 * all, because a method only one platform can honour would push the branch
 * back into the loop.
 */
export interface Driver {
  dumpUi(): Promise<UiNode>;
  /**
   * Labels a history line with the screen a decision was made on, e.g.
   * `.MainActivity` or `/checkout`. Optional so a driver that cannot say
   * degrades to the older unlabelled format rather than failing.
   */
  screenLabel?(): Promise<string>;
  tap(x: number, y: number): Promise<void>;
  typeText(text: string): Promise<void>;
  swipe(direction: SwipeDirection): Promise<void>;
  keyevent(key: KeyName): Promise<void>;
  /** Writes a screenshot to `destPath` and returns it. */
  screencap(destPath: string): Promise<string>;
  /**
   * Puts the target back in its opening state before a case starts.
   *
   * One method rather than the stop/launch pair it replaces: Android
   * force-stops and relaunches an activity, the browser discards a context and
   * navigates, and the loop has no business knowing which. A driver with no
   * target to reset does nothing, which is what a scenario naming no target has
   * always meant -- the case drives whatever is already on screen.
   */
  reset(): Promise<void>;
}

/**
 * A driver opened for one case, together with the recorder that films it.
 *
 * The pair travels as a unit because both are chosen by the same target: a web
 * case needs the CDP driver *and* the CDP recorder, and handing the loop an
 * android recorder alongside a web driver would film the wrong screen.
 */
export interface DriverSession {
  driver: Driver;
  /** Omitted, the case runs unrecorded and its `videoPath` stays null. */
  recorder?: Recorder | undefined;
  /**
   * Releases whatever the session holds. Called once per case, however the
   * case ended. Android shares one long-lived adb client so this is a no-op;
   * the browser disposes the context the case ran in.
   */
  close(): Promise<void>;
}

/**
 * Opens the driver a case's target calls for.
 *
 * A function rather than a class hierarchy: `Target` is a discriminated union,
 * so the implementation is a `switch` the compiler checks for exhaustiveness --
 * adding a platform breaks the build at the one place that must change. Mirrors
 * `LlmFactory`, which resolves a model the same way.
 *
 * `undefined` is a legitimate target: the case drives whatever is on screen.
 */
export type OpenDriver = (target: Target | undefined) => Promise<DriverSession>;
