import type { RunStatus } from "@gemma-e2e/core/schema";

/**
 * How the run page's status reacts to a streamed event.
 *
 * Lives here rather than inside RunPage because this is the decision with a
 * consequence -- a page that never leaves `queued` shows "Waiting for the
 * device" while cases and steps stream in underneath it, and hides both the
 * progress bar and the live screen for the whole run -- while the component
 * around it is markup that would need a DOM and a testing library this app does
 * not carry.
 */

/** The subset of a streamed event this decision reads. */
export interface StatusSignal {
  type: string;
  /** Only `run_finished` carries one; everything else leaves the status alone. */
  status?: RunStatus;
}

/**
 * The status to display after `event`, or `null` to keep the current one.
 *
 * Why `case_started` promotes a queued run rather than waiting for
 * `run_started`: the two are not interchangeable. `run_started` is published
 * once, at the moment the queue hands the run to a device, so a page opened
 * after that instant never sees it -- it subscribes, replays a case or two, and
 * would sit on `queued` with a timeline visibly filling in. `case_started`
 * replays, so it is the signal that survives a late attach. Subscribing to both
 * is what makes the page correct whether it was open before the turn came or
 * opened halfway through.
 *
 * Why only `queued` is promoted, rather than setting `running` unconditionally:
 * a finished run replays its whole timeline, `case_started` included, and
 * flipping a `passed` run back to `running` would spin a progress bar over a
 * verdict that is already in.
 */
export function nextRunStatus(current: RunStatus | null, event: StatusSignal): RunStatus | null {
  const isTerminal = event.type === "run_finished";
  if (isTerminal) {
    return event.status ?? null;
  }

  const isStartSignal = event.type === "run_started" || event.type === "case_started";
  const startsTheRun = isStartSignal && current === "queued";
  if (startsTheRun) {
    return "running";
  }

  return null;
}
