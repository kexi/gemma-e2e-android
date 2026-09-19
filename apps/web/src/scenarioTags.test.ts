import { describe, expect, test } from "bun:test";
import { parseTags } from "./ScenarioBuilder.tsx";

/**
 * Only the parse is tested, not the dialog around it: rendering React needs a
 * DOM and a testing library this app does not carry, and what the file on disk
 * ends up saying is decided entirely here.
 */
describe("parseTags", () => {
  test("splits a comma-separated field into one tag per entry", () => {
    expect(parseTags("smoke,auth")).toEqual(["smoke", "auth"]);
  });

  test("trims the spaces a human types around the commas", () => {
    expect(parseTags(" smoke ,  auth ")).toEqual(["smoke", "auth"]);
  });

  test("drops the empty entry a trailing comma leaves, which the server would reject as a tag", () => {
    expect(parseTags("smoke, auth,")).toEqual(["smoke", "auth"]);
    expect(parseTags("smoke,,auth")).toEqual(["smoke", "auth"]);
  });

  test("reads a blank field as no tags rather than as one empty tag", () => {
    expect(parseTags("")).toEqual([]);
    expect(parseTags("   ")).toEqual([]);
    expect(parseTags(",")).toEqual([]);
  });

  test("passes a value the server's slug rule will reject through unchanged, so the user is told rather than silently corrected", () => {
    expect(parseTags("Smoke Test")).toEqual(["Smoke Test"]);
  });
});
