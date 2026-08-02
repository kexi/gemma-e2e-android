import { describe, expect, test } from "bun:test";
import { correctionFor } from "./DevicePlatformPicker.tsx";

/**
 * Only the decision is tested here, not the component: rendering React needs a
 * DOM and a testing library this app does not carry, and what actually broke
 * was the rule, not the markup.
 */
describe("correctionFor", () => {
  test("corrects a stored choice the server cannot serve", () => {
    // The case that was broken. A web-only deployment left the view asking for
    // android -- 404 on every request -- with the picker hidden and no control
    // to escape it.
    expect(correctionFor(["web"], "android")).toBe("web");
    expect(correctionFor(["android"], "web")).toBe("android");
  });

  test("leaves a choice the sole platform already matches", () => {
    expect(correctionFor(["web"], "web")).toBeNull();
    expect(correctionFor(["android"], "android")).toBeNull();
  });

  test("leaves the user alone whenever a picker is on screen", () => {
    // Both attached is the normal case: the user can move for themselves, and
    // correcting here would override the choice they just made.
    expect(correctionFor(["android", "web"], "android")).toBeNull();
    expect(correctionFor(["android", "web"], "web")).toBeNull();
  });

  test("corrects nothing when the server offers nothing", () => {
    // No live view at all; there is no platform to correct to.
    expect(correctionFor([], "android")).toBeNull();
  });
});
