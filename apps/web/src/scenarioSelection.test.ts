import { describe, expect, test } from "bun:test";
import type { Scenario } from "@gemma-e2e/core/schema";
import {
  remainingAfterPartialBatch,
  retainAfterReload,
  retainVisible,
  toggleInList,
  toggleInSet,
} from "./scenarioSelection.ts";

function scenario(id: string, tags: string[]): Scenario {
  return {
    id,
    title: id,
    tags,
    cases: [{ id: "only", prompt: "do the thing", maxSteps: 5 }],
  };
}

/**
 * Only the decisions are tested here, not the rail: rendering React needs a DOM
 * and a testing library this app does not carry, and what a reader has to trust
 * is the rule -- that a batch never starts a scenario the filter has hidden.
 */
describe("retainVisible", () => {
  test("drops a selected scenario the tag filter has hidden, so a batch cannot run it unseen", () => {
    const selected = new Set(["login", "shop"]);

    expect([...retainVisible(selected, ["login"])]).toEqual(["login"]);
  });

  test("keeps every selection that is still on screen", () => {
    const selected = new Set(["login", "shop"]);

    expect([...retainVisible(selected, ["login", "shop", "checkout"])].sort()).toEqual([
      "login",
      "shop",
    ]);
  });

  test("empties the selection when the filter matches nothing", () => {
    expect([...retainVisible(new Set(["login"]), [])]).toEqual([]);
  });

  test("leaves the caller's set untouched, so React sees a new value to render", () => {
    const selected = new Set(["login", "shop"]);
    const kept = retainVisible(selected, ["login"]);

    expect(kept).not.toBe(selected);
    expect(selected.size).toBe(2);
  });
});

describe("retainAfterReload", () => {
  const ALL = [scenario("login", ["smoke"]), scenario("shop", ["regression"])];

  test("drops a tick the active tag filter hides, so a refetch cannot smuggle it into a batch", () => {
    // The failure this guards: the rail refetches while `smoke` is chosen --
    // after an edit, a delete, or the initial load -- and `shop` is off screen.
    // Narrowing against every id on disk would leave it ticked, and pressing
    // "Run 2 selected" would start a run for a card the user cannot see.
    const kept = retainAfterReload(new Set(["login", "shop"]), ALL, ["smoke"]);

    expect([...kept]).toEqual(["login"]);
  });

  test("keeps every tick that the filter still shows", () => {
    const kept = retainAfterReload(new Set(["login", "shop"]), ALL, []);

    expect([...kept].sort()).toEqual(["login", "shop"]);
  });

  test("drops a tick for a scenario that has left the directory entirely", () => {
    const kept = retainAfterReload(new Set(["login", "deleted"]), ALL, []);

    expect([...kept]).toEqual(["login"]);
  });

  test("drops a tick for a scenario edited until it no longer carries the chosen tag", () => {
    const retagged = [scenario("login", ["regression"]), scenario("shop", ["regression"])];

    expect([...retainAfterReload(new Set(["login"]), retagged, ["smoke"])]).toEqual([]);
  });

  test("returns a new set rather than mutating the one in state", () => {
    const selected = new Set(["login", "shop"]);
    const kept = retainAfterReload(selected, ALL, ["smoke"]);

    expect(kept).not.toBe(selected);
    expect(selected.size).toBe(2);
  });
});

describe("toggleInSet", () => {
  test("ticks a scenario that was not selected", () => {
    expect([...toggleInSet(new Set<string>(), "login")]).toEqual(["login"]);
  });

  test("unticks a scenario that was already selected", () => {
    expect([...toggleInSet(new Set(["login", "shop"]), "login")]).toEqual(["shop"]);
  });

  test("returns a new set rather than mutating the one in state", () => {
    const selected = new Set(["login"]);
    const next = toggleInSet(selected, "shop");

    expect(next).not.toBe(selected);
    expect([...selected]).toEqual(["login"]);
  });
});

describe("remainingAfterPartialBatch", () => {
  test("unticks the scenarios the server already queued, so retrying cannot run them twice", () => {
    // The failure this guards: the first scenario is enqueued, the second's
    // write fails. Leaving both ticked means the user's retry starts the first
    // one a second time on the same device.
    expect([...remainingAfterPartialBatch(["login", "shop"], 1)]).toEqual(["shop"]);
  });

  test("keeps the whole selection when nothing was accepted, so the retry is the same batch", () => {
    expect([...remainingAfterPartialBatch(["login", "shop"], 0)]).toEqual(["login", "shop"]);
  });

  test("empties the selection when every scenario was accepted", () => {
    expect([...remainingAfterPartialBatch(["login", "shop"], 2)]).toEqual([]);
  });

  test("keeps the remainder visible when a server claims more accepted than were asked for", () => {
    expect([...remainingAfterPartialBatch(["login"], 5)]).toEqual([]);
    expect([...remainingAfterPartialBatch(["login", "shop"], -1)]).toEqual(["login", "shop"]);
  });
});

describe("toggleInList", () => {
  test("appends a newly chosen tag, keeping the order the user clicked in", () => {
    expect(toggleInList(["smoke"], "auth")).toEqual(["smoke", "auth"]);
  });

  test("removes a tag that was already chosen, which is how the filter is cleared", () => {
    expect(toggleInList(["smoke", "auth"], "smoke")).toEqual(["auth"]);
  });

  test("returns a new array rather than mutating the one in state", () => {
    const selected = ["smoke"];
    const next = toggleInList(selected, "auth");

    expect(next).not.toBe(selected);
    expect(selected).toEqual(["smoke"]);
  });
});
