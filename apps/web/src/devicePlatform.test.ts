import { describe, expect, test } from "bun:test";
import { failureLabelFor } from "./devicePlatform.ts";

describe("failureLabelFor", () => {
  test("names the source that is actually unreachable", () => {
    // The bug this replaces: a browser view announced "Emulator unreachable"
    // and told the reader to run `just emu`, which has nothing to do with it.
    expect(failureLabelFor("android")).toBe("Emulator unreachable");
    expect(failureLabelFor("web")).toBe("Browser unreachable");
  });
});
