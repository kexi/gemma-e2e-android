import { describe, expect, test } from "bun:test";
import {
  clampRailWidth,
  MIN_MAIN_WIDTH,
  MIN_RAIL_WIDTH,
  maxRailWidth,
  railWidthForKey,
} from "./railWidth.ts";

const VIEWPORT = 1440;

describe("clampRailWidth", () => {
  test("keeps a width that fits as it is", () => {
    expect(clampRailWidth(500, VIEWPORT)).toBe(500);
  });

  test("never lets the rail shrink below its minimum", () => {
    expect(clampRailWidth(10, VIEWPORT)).toBe(MIN_RAIL_WIDTH);
  });

  test("never lets the rail squeeze the main pane below its minimum", () => {
    // A width remembered on a wide monitor must not swallow a laptop screen.
    expect(clampRailWidth(5000, VIEWPORT)).toBe(VIEWPORT - MIN_MAIN_WIDTH);
  });

  test("keeps the rail's minimum when the viewport cannot fit both panes", () => {
    expect(clampRailWidth(400, 500)).toBe(MIN_RAIL_WIDTH);
    expect(maxRailWidth(500)).toBe(MIN_RAIL_WIDTH);
  });

  test("lands on whole pixels, so the handle reports a clean value", () => {
    expect(clampRailWidth(333.6, VIEWPORT)).toBe(334);
  });
});

describe("railWidthForKey", () => {
  test("steps with the arrow keys, further with Shift", () => {
    expect(railWidthForKey("ArrowRight", false, 400, VIEWPORT)).toBe(416);
    expect(railWidthForKey("ArrowLeft", false, 400, VIEWPORT)).toBe(384);
    expect(railWidthForKey("ArrowRight", true, 400, VIEWPORT)).toBe(464);
  });

  test("jumps to the limits with Home and End", () => {
    expect(railWidthForKey("Home", false, 400, VIEWPORT)).toBe(MIN_RAIL_WIDTH);
    expect(railWidthForKey("End", false, 400, VIEWPORT)).toBe(VIEWPORT - MIN_MAIN_WIDTH);
  });

  test("stays inside the limits at the edges", () => {
    expect(railWidthForKey("ArrowLeft", true, MIN_RAIL_WIDTH, VIEWPORT)).toBe(MIN_RAIL_WIDTH);
  });

  test("ignores keys the handle does not use, so they keep their default action", () => {
    expect(railWidthForKey("Tab", false, 400, VIEWPORT)).toBeNull();
    expect(railWidthForKey("ArrowUp", false, 400, VIEWPORT)).toBeNull();
  });
});
