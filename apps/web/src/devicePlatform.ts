import { type Messages, messagesFor } from "./i18n.ts";

/** The live view sources the dashboard can show. */
export type DevicePlatform = "android" | "web";

/**
 * How an unreachable source is announced.
 *
 * Lives here rather than beside the component because that module reads
 * `document` at import time, which `bun test` has no DOM for -- and the
 * wording is the part worth testing: a browser view used to tell the reader to
 * start an Android emulator.
 *
 * English unless told otherwise, so a caller without the active language (a
 * test, a log line) still gets the wording this function has always returned.
 */
export function failureLabelFor(
  platform: DevicePlatform,
  messages: Messages = messagesFor("en"),
): string {
  return messages.liveView.unreachable[platform];
}
