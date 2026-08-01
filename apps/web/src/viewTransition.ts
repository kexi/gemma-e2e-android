import { useCallback } from "react";
import { useNavigate } from "react-router-dom";

export type TransitionDirection = "forward" | "backward";

/**
 * Runs `update` inside a directional view transition, or immediately when the
 * browser has no View Transitions API.
 *
 * Why not react-router's own `viewTransition` navigation flag: it always starts
 * an untyped transition, so `:active-view-transition-type()` never matches and
 * forward and backward would animate identically — the direction is the whole
 * point of the effect here.
 */
export function startDirectionalTransition(
  update: () => Promise<void>,
  direction: TransitionDirection,
): void {
  // The property is on Document in every current browser but the type says it
  // is always there, so the check has to look past the declaration.
  const canTransition = typeof document.startViewTransition === "function";
  if (!canTransition) {
    void update();
    return;
  }

  document.startViewTransition({ update, types: [direction] });
}

export type DirectionalNavigate = (to: string, direction: TransitionDirection) => void;

/**
 * Navigation that slides the main pane in the direction the user is moving:
 * opening a run from the rail goes forward, returning to the idle device view
 * goes backward.
 */
export function useDirectionalNavigate(): DirectionalNavigate {
  const navigate = useNavigate();

  return useCallback(
    (to: string, direction: TransitionDirection) => {
      startDirectionalTransition(async () => {
        await navigate(to);
        // React commits asynchronously after the router resolves, so the
        // transition has to wait one frame or it snapshots the old pane
        // twice and nothing appears to move.
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }, direction);
    },
    [navigate],
  );
}
