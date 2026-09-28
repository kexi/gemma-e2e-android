import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import Box from "@mui/material/Box";
import { useI18n } from "./I18nProvider.tsx";
import {
  clampRailWidth,
  DEFAULT_RAIL_WIDTH,
  MIN_MAIN_WIDTH,
  MIN_RAIL_WIDTH,
  maxRailWidth,
  railWidthForKey,
} from "./railWidth.ts";

const STORAGE_KEY = "gemma-e2e.rail-width";

function storedWidth(): number | null {
  try {
    const value = Number(window.localStorage.getItem(STORAGE_KEY));
    const isUsable = Number.isFinite(value) && value > 0;
    return isUsable ? value : null;
  } catch {
    // Storage can be denied outright (private mode, blocked cookies). The
    // handle still works, it just forgets between visits.
    return null;
  }
}

function rememberWidth(width: number) {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(width));
  } catch {
    // As above: remembering is a convenience, not a requirement.
  }
}

interface Drag {
  startX: number;
  startWidth: number;
  latest: number;
}

/**
 * The standing left rail and the handle on its edge that resizes it, from `md`
 * up. The width is remembered per browser, like the live view's platform.
 *
 * Takes the rail's content as `children`, so a drag re-renders only this
 * component: the parent built that element and never renders mid-drag, and
 * React skips an element it has already seen. Rendering the Sidebar itself
 * here would repaint its whole run list on every pointer move.
 *
 * Why not react-resizable-panels: one handle between two panes is a few dozen
 * lines, and a dependency would bring a layout model of its own to reconcile
 * with the Drawer below `md`. Why not CSS `resize: horizontal`: it offers only
 * a corner grip, with no keyboard control and no way to learn the new width.
 */
export function ResizableRail({ children }: { children: ReactNode }) {
  const railId = useId();
  const { t } = useI18n();
  const [width, setWidth] = useState(() => storedWidth() ?? DEFAULT_RAIL_WIDTH);
  const drag = useRef<Drag | null>(null);

  // The width as laid out. The stored one may be wider than this window allows
  // (it was set on a bigger screen) and is kept as is, so it comes back there.
  const viewportWidth = window.innerWidth;
  const shownWidth = clampRailWidth(width, viewportWidth);

  const resizeTo = (next: number) => {
    setWidth(next);
    rememberWidth(next);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const isPrimaryButton = event.button === 0;
    if (!isPrimaryButton) return;

    // Capture keeps the moves coming while the pointer is over the main pane,
    // including the live view's <img>, which would otherwise start its own drag.
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startX: event.clientX, startWidth: shownWidth, latest: shownWidth };
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (current === null) return;

    const next = clampRailWidth(
      current.startWidth + event.clientX - current.startX,
      window.innerWidth,
    );
    const hasMoved = next !== current.latest;
    if (!hasMoved) return;

    current.latest = next;
    setWidth(next);
  };

  // Storage is written once the drag ends rather than on every move.
  const handleDragEnd = () => {
    const current = drag.current;
    if (current === null) return;

    drag.current = null;
    rememberWidth(current.latest);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = railWidthForKey(event.key, event.shiftKey, shownWidth, window.innerWidth);
    if (next === null) return;

    event.preventDefault();
    resizeTo(next);
  };

  return (
    <>
      <Box
        component="nav"
        id={railId}
        // `style`, not `sx`: emotion mints a class per distinct value, and a
        // drag passes through hundreds of them.
        style={{ width }}
        sx={{
          flexShrink: 0,
          // The same limits as `clampRailWidth`, held by CSS so a window made
          // narrower after the drag still leaves the main pane its room.
          minWidth: MIN_RAIL_WIDTH,
          maxWidth: `calc(100% - ${MIN_MAIN_WIDTH}px)`,
          display: { xs: "none", md: "block" },
          borderRight: 1,
          borderColor: "divider",
          overflowY: "auto",
        }}
      >
        {children}
      </Box>

      <Box
        role="separator"
        tabIndex={0}
        aria-orientation="vertical"
        aria-controls={railId}
        aria-label={t.rail.resize}
        aria-valuenow={shownWidth}
        aria-valuemin={MIN_RAIL_WIDTH}
        aria-valuemax={maxRailWidth(viewportWidth)}
        title={t.rail.resizeHint}
        className="rail-resizer"
        sx={{ display: { xs: "none", md: "block" } }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handleDragEnd}
        onPointerCancel={handleDragEnd}
        onLostPointerCapture={handleDragEnd}
        onKeyDown={handleKeyDown}
        onDoubleClick={() => resizeTo(DEFAULT_RAIL_WIDTH)}
      />
    </>
  );
}
