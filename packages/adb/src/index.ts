export {
  AdbClient,
  AdbError,
  escapeInputText,
  parseFocusedActivity,
  shortenActivity,
} from "./client.ts";
export type {
  AdbClientOptions,
  BinaryCommandResult,
  BinaryCommandRunner,
  CommandResult,
  CommandRunner,
} from "./client.ts";

export { parseBounds, parseUiDump, UiDumpParseError } from "./parse.ts";

// Re-exported from core, where the serializer moved once a second platform
// needed it: a web driver has no business depending on the adb package. Kept
// here so existing imports keep resolving.
export { centerOf, serializeForLlm } from "@gemma-e2e/core";
export type { SerializedUi, UiRef } from "@gemma-e2e/core";
