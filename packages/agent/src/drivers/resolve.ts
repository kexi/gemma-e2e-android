import type { Target } from "@gemma-e2e/core";
import type { DriverSession, OpenDriver } from "../driver.ts";
import type { Recorder } from "../recorder.ts";
import { type AdbLike, AndroidDriver } from "./android.ts";

/**
 * One platform's long-lived halves, built once at startup and shared by every
 * case that names it. Both are configuration only, so a device or browser that
 * is absent costs nothing here and instead surfaces as a case with
 * status=error.
 */
export interface AndroidPlatform {
  adb: AdbLike;
  /** Omitted, android cases run unrecorded. */
  recorder?: Recorder | undefined;
}

export interface DriverResolverDeps {
  android: AndroidPlatform;
}

/**
 * Builds the {@link OpenDriver} the loop takes.
 *
 * A `switch` over the target union rather than a registry or a factory class:
 * the union is closed, so the compiler reports every site that must change when
 * a platform is added, which no lookup table can do. Mirrors `LlmFactory`,
 * which resolves a model the same way.
 */
export function createDriverResolver(deps: DriverResolverDeps): OpenDriver {
  return async (target: Target | undefined): Promise<DriverSession> => {
    // No target names no platform, so the case drives whatever is already on
    // screen. Android is the only thing that can be already-on-screen without
    // having been opened, which makes it the right default here.
    const isUntargeted = target === undefined;
    if (isUntargeted) {
      return androidSession(deps.android);
    }

    switch (target.platform) {
      case "android":
        return androidSession(deps.android, target);
      case "web":
        throw new Error("web targets need a browser: this build has no CDP driver wired in yet");
    }
  };
}

function androidSession(
  platform: AndroidPlatform,
  target?: Extract<Target, { platform: "android" }> | undefined,
): DriverSession {
  return {
    driver: new AndroidDriver(platform.adb, target),
    ...(platform.recorder === undefined ? {} : { recorder: platform.recorder }),
    // Nothing to release: the adb client and the recorder outlive every case,
    // and the app is reset at the start of the next one rather than torn down
    // at the end of this one.
    close: async () => {},
  };
}
