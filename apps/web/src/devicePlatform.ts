/** The live view sources the dashboard can show. */
export type DevicePlatform = "android" | "web";

/** What each source is called on screen, so a failure names the right thing. */
const SOURCE_LABEL: Record<DevicePlatform, string> = {
  android: "Emulator",
  web: "Browser",
};

/**
 * How an unreachable source is announced.
 *
 * Lives here rather than beside the component because that module reads
 * `document` at import time, which `bun test` has no DOM for -- and the
 * wording is the part worth testing: a browser view used to tell the reader to
 * start an Android emulator.
 */
export function failureLabelFor(platform: DevicePlatform): string {
  return `${SOURCE_LABEL[platform]} unreachable`;
}
