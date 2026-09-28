/** The rail's width before anyone resizes it, and what a double-click returns to. */
export const DEFAULT_RAIL_WIDTH = 340;

/** Below this the run titles and the start controls stop fitting on one line. */
export const MIN_RAIL_WIDTH = 240;

/** The main pane never shrinks below this, so the live screen stays readable. */
export const MIN_MAIN_WIDTH = 360;

/** One arrow key press, and one with Shift held. */
const KEY_STEP = 16;
const LARGE_KEY_STEP = 64;

/** The widest the rail may grow in a viewport this wide. */
export function maxRailWidth(viewportWidth: number): number {
  // A viewport too narrow for both minimums keeps the rail's; below the `md`
  // breakpoint the rail is a Drawer anyway, so this only guards odd sizes.
  return Math.max(MIN_RAIL_WIDTH, viewportWidth - MIN_MAIN_WIDTH);
}

/** Holds a requested width inside what the viewport leaves room for. */
export function clampRailWidth(width: number, viewportWidth: number): number {
  const upper = maxRailWidth(viewportWidth);
  return Math.round(Math.min(Math.max(width, MIN_RAIL_WIDTH), upper));
}

/**
 * The width a key press on the resize handle moves to, or `null` for a key the
 * handle does not use. Follows the WAI-ARIA window splitter pattern: arrows
 * step, Home and End jump to the limits.
 */
export function railWidthForKey(
  key: string,
  isLargeStep: boolean,
  current: number,
  viewportWidth: number,
): number | null {
  const step = isLargeStep ? LARGE_KEY_STEP : KEY_STEP;
  switch (key) {
    case "ArrowLeft":
      return clampRailWidth(current - step, viewportWidth);
    case "ArrowRight":
      return clampRailWidth(current + step, viewportWidth);
    case "Home":
      return MIN_RAIL_WIDTH;
    case "End":
      return maxRailWidth(viewportWidth);
    default:
      return null;
  }
}
