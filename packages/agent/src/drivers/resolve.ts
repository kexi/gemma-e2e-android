import type { Target, WebTarget } from "@gemma-e2e/core";
import type { DriverSession, OpenDriver } from "../driver.ts";
import type { Recorder } from "../recorder.ts";
import { type AdbLike, AndroidDriver } from "./android.ts";
import { type CdpLike, WebDriver } from "./web.ts";

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

export interface WebPlatform {
  cdp: CdpLike;
  /**
   * Built per session, unlike android's: a screencast belongs to one page, so
   * the recorder cannot be shared across cases the way scrcpy's is. Omitted,
   * web cases run unrecorded.
   */
  recorder?: ((session: { sessionId: string }) => Recorder) | undefined;
}

export interface DriverResolverDeps {
  android: AndroidPlatform;
  /** Omitted, a web target reports that this build has no browser wired in. */
  web?: WebPlatform | undefined;
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
        return await webSession(deps.web, target);
    }
  };
}

/**
 * Opens a page in a context of its own and hands back the driver bound to it.
 *
 * Unlike android's, this session owns something: closing it disposes the
 * browser context, which is what stops one case's cookies and storage from
 * reaching the next.
 */
async function webSession(
  platform: WebPlatform | undefined,
  target: WebTarget,
): Promise<DriverSession> {
  const isConfigured = platform !== undefined;
  if (!isConfigured) {
    throw new Error("this build has no browser wired in, so a web target cannot be driven");
  }

  const session = await platform.cdp.openSession(target.viewport);

  return {
    driver: new WebDriver(platform.cdp, session, target),
    ...(platform.recorder === undefined ? {} : { recorder: platform.recorder(session) }),
    close: async () => {
      await platform.cdp.closeSession(session);
    },
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
