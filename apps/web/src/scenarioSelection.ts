/**
 * What survives a change to the tag filter, out of whatever was ticked before it.
 *
 * Lives here rather than inside the Sidebar because this is the rule with a
 * consequence -- a scenario that stays selected while off screen is one that
 * runs without the user seeing it asked for -- and the rail around it is markup
 * that would need a DOM and a testing library this app does not carry.
 */

import { filterByTags, type Scenario } from "@gemma-e2e/core/schema";

/**
 * Narrows `selected` to the ids still on screen.
 *
 * Why not keep the hidden ids and restore them when the filter is cleared: the
 * "Run N selected" button would then count scenarios the list is not showing,
 * and pressing it would start runs the user has no way to see they asked for.
 * Losing a tick when the filter moves is the smaller surprise, and it is a
 * surprise the user can see happen.
 */
export function retainVisible(selected: ReadonlySet<string>, visibleIds: string[]): Set<string> {
  const visible = new Set(visibleIds);
  const kept = new Set<string>();
  for (const id of selected) {
    if (visible.has(id)) {
      kept.add(id);
    }
  }
  return kept;
}

/**
 * Adds or removes one value, returning a new collection.
 *
 * A new Set/array each time rather than a mutation, because React compares
 * these by identity: mutating the one already in state changes what a later
 * render reads without ever scheduling that render.
 */
export function toggleInSet(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  const isSelected = next.has(id);
  if (isSelected) {
    next.delete(id);
    return next;
  }
  next.add(id);
  return next;
}

/**
 * What is left to retry after a batch was only partly accepted.
 *
 * `requested` is the ordered list the batch was posted with; `acceptedCount` is
 * how many of them the server got onto the queue before it failed. The server
 * enqueues strictly in the order it was given, so the accepted ids are exactly
 * the leading `acceptedCount` -- which is why this takes a count rather than
 * matching run ids back to scenarios, a mapping the response does not carry.
 *
 * Why the accepted ones must be dropped rather than left ticked: they are
 * already on the device and will produce real verdicts. Leaving them selected
 * means the obvious next move -- press "Run N selected" again -- runs them a
 * second time, which is the double execution the server's partial response
 * exists to prevent.
 */
export function remainingAfterPartialBatch(
  requested: readonly string[],
  acceptedCount: number,
): Set<string> {
  // Clamped rather than trusted: a server that reported more accepted than
  // were asked for would otherwise slice past the end and silently clear the
  // whole selection, hiding work the user still has to retry.
  const accepted = Math.min(Math.max(acceptedCount, 0), requested.length);
  return new Set(requested.slice(accepted));
}

/**
 * What stays ticked after the scenario list is refetched under an active filter.
 *
 * The single rule for every way the list can change beneath a selection -- a
 * scenario created, edited into or out of a tag, or deleted -- and the reason it
 * takes `tags` at all: narrowing against everything on disk instead keeps a tick
 * on a scenario the chips are hiding, so "Run N selected" counts it and then
 * starts a run the user cannot see they asked for. That is the same failure
 * {@link retainVisible} exists to prevent, reached through the reload path
 * rather than the filter path, which is why both paths go through here.
 */
export function retainAfterReload(
  selected: ReadonlySet<string>,
  scenarios: Scenario[],
  tags: string[],
): Set<string> {
  const visibleIds = filterByTags(scenarios, tags).map((one) => one.id);
  return retainVisible(selected, visibleIds);
}

/** The tag list with `tag` flipped. Order is the caller's; nothing here sorts it. */
export function toggleInList(selected: readonly string[], tag: string): string[] {
  const isSelected = selected.includes(tag);
  if (isSelected) {
    return selected.filter((one) => one !== tag);
  }
  return [...selected, tag];
}
