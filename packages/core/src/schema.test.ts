import { describe, expect, test } from "bun:test";
import {
  ActionSchema,
  CaseRunSchema,
  CaseStatusSchema,
  collectTags,
  describeTarget,
  filterByTags,
  isUnsettledRun,
  resolveModel,
  resolveTarget,
  RunStatusSchema,
  type Scenario,
  ScenarioSchema,
  TestCaseSchema,
  UiNodeSchema,
  UNSETTLED_RUN_STATUSES,
} from "./schema.ts";

describe("ActionSchema", () => {
  test("accepts every action variant", () => {
    const actions = [
      { type: "tap", ref: 0 },
      { type: "input_text", ref: 3, text: "hunter2" },
      { type: "swipe", direction: "up" },
      { type: "key_event", key: "back" },
      { type: "wait", ms: 500 },
      { type: "remember", text: "confirmation code 4821" },
      { type: "finish", verdict: "passed", reason: "home screen reached" },
    ];

    for (const action of actions) {
      expect(ActionSchema.safeParse(action).success).toBe(true);
    }
  });

  test("rejects an unknown action type", () => {
    expect(ActionSchema.safeParse({ type: "scroll", ref: 1 }).success).toBe(false);
  });

  test("rejects a tap without a ref", () => {
    expect(ActionSchema.safeParse({ type: "tap" }).success).toBe(false);
  });

  test("rejects a negative or fractional ref", () => {
    expect(ActionSchema.safeParse({ type: "tap", ref: -1 }).success).toBe(false);
    expect(ActionSchema.safeParse({ type: "tap", ref: 1.5 }).success).toBe(false);
  });

  test("rejects an unknown swipe direction and key", () => {
    expect(ActionSchema.safeParse({ type: "swipe", direction: "sideways" }).success).toBe(false);
    expect(ActionSchema.safeParse({ type: "key_event", key: "menu" }).success).toBe(false);
  });

  test("rejects a non-positive wait", () => {
    expect(ActionSchema.safeParse({ type: "wait", ms: 0 }).success).toBe(false);
  });

  test("rejects a remember with nothing to remember", () => {
    expect(ActionSchema.safeParse({ type: "remember", text: "" }).success).toBe(false);
    expect(ActionSchema.safeParse({ type: "remember" }).success).toBe(false);
  });

  test("rejects a finish with a verdict outside passed/failed", () => {
    expect(
      ActionSchema.safeParse({ type: "finish", verdict: "unknown", reason: "x" }).success,
    ).toBe(false);
  });
});

describe("UiNodeSchema", () => {
  const leaf = {
    text: "Sign in",
    resourceId: "com.example:id/login",
    className: "android.widget.Button",
    contentDesc: "",
    bounds: { x1: 0, y1: 0, x2: 100, y2: 50 },
    clickable: true,
    enabled: true,
    focused: false,
    children: [],
  };

  test("accepts a nested tree", () => {
    const tree = { ...leaf, clickable: false, children: [leaf] };
    const parsed = UiNodeSchema.safeParse(tree);
    expect(parsed.success).toBe(true);
  });

  test("accepts an optional checked flag", () => {
    expect(UiNodeSchema.safeParse({ ...leaf, checked: true }).success).toBe(true);
  });

  test("rejects malformed bounds", () => {
    expect(UiNodeSchema.safeParse({ ...leaf, bounds: { x1: 0, y1: 0 } }).success).toBe(false);
  });

  test("rejects a missing required field", () => {
    const { text: _text, ...withoutText } = leaf;
    expect(UiNodeSchema.safeParse(withoutText).success).toBe(false);
  });
});

describe("TestCaseSchema", () => {
  test("defaults maxSteps when the file omits it", () => {
    expect(TestCaseSchema.parse({ id: "logs-in", prompt: "log in" }).maxSteps).toBe(20);
  });

  test("keeps an explicit maxSteps, title, and model", () => {
    const parsed = TestCaseSchema.parse({
      id: "logs-in",
      title: "Logs in",
      prompt: "log in",
      model: "gemma-4-e4b",
      maxSteps: 5,
    });

    expect(parsed.maxSteps).toBe(5);
    expect(parsed.title).toBe("Logs in");
    expect(parsed.model).toBe("gemma-4-e4b");
  });

  test("rejects an id that is not a lowercase slug", () => {
    const bad = ["Logs In", "logs_in", "-leading", "UPPER", ""];
    for (const id of bad) {
      expect(TestCaseSchema.safeParse({ id, prompt: "p" }).success).toBe(false);
    }
  });

  test("accepts a slug with digits and hyphens", () => {
    expect(TestCaseSchema.safeParse({ id: "case-2-retry", prompt: "p" }).success).toBe(true);
  });

  test("rejects an empty prompt and a non-positive maxSteps", () => {
    expect(TestCaseSchema.safeParse({ id: "a", prompt: "" }).success).toBe(false);
    expect(TestCaseSchema.safeParse({ id: "a", prompt: "p", maxSteps: 0 }).success).toBe(false);
  });
});

describe("ScenarioSchema", () => {
  const oneCase = [{ id: "logs-in", prompt: "log in" }];

  test("accepts a scenario with a target and a default model", () => {
    const parsed = ScenarioSchema.parse({
      id: "login",
      title: "Login",
      target: { platform: "android", package: "com.example", activity: ".MainActivity" },
      model: "gemma-4-12b",
      cases: oneCase,
    });

    expect(parsed.target).toEqual({
      platform: "android",
      package: "com.example",
      activity: ".MainActivity",
    });
    expect(parsed.model).toBe("gemma-4-12b");
    expect(parsed.cases).toHaveLength(1);
  });

  test("accepts a web target", () => {
    const parsed = ScenarioSchema.parse({
      id: "login",
      title: "Login",
      target: { platform: "web", url: "http://localhost:5174" },
      cases: oneCase,
    });

    expect(parsed.target).toEqual({ platform: "web", url: "http://localhost:5174" });
  });

  test("rejects a target that mixes the two platforms' fields", () => {
    const parsed = ScenarioSchema.safeParse({
      id: "login",
      title: "Login",
      target: { platform: "web", package: "com.example" },
      cases: oneCase,
    });

    expect(parsed.success).toBe(false);
  });

  test("reads the legacy `app:` key as an android target", () => {
    const parsed = ScenarioSchema.parse({
      id: "login",
      title: "Login",
      app: { package: "com.example", activity: ".MainActivity" },
      cases: oneCase,
    });

    expect(parsed.target).toEqual({
      platform: "android",
      package: "com.example",
      activity: ".MainActivity",
    });
  });

  test("lets an explicit target win over a legacy `app:` left alongside it", () => {
    const parsed = ScenarioSchema.parse({
      id: "login",
      title: "Login",
      app: { package: "com.example" },
      target: { platform: "web", url: "http://localhost:5174" },
      cases: oneCase,
    });

    expect(parsed.target).toEqual({ platform: "web", url: "http://localhost:5174" });
  });

  test("rejects a malformed legacy `app:` rather than loading with no target", () => {
    const parsed = ScenarioSchema.safeParse({
      id: "login",
      title: "Login",
      app: { activity: ".MainActivity" },
      cases: oneCase,
    });

    expect(parsed.success).toBe(false);
  });

  test("lets a case override the scenario's target", () => {
    const parsed = ScenarioSchema.parse({
      id: "mixed",
      title: "Mixed",
      target: { platform: "android", package: "com.example" },
      cases: [
        { id: "on-device", prompt: "log in" },
        { id: "in-browser", prompt: "log in", target: { platform: "web", url: "http://x.test" } },
      ],
    });

    expect(resolveTarget(parsed.cases[0]!, parsed)).toEqual({
      platform: "android",
      package: "com.example",
    });
    expect(resolveTarget(parsed.cases[1]!, parsed)).toEqual({
      platform: "web",
      url: "http://x.test",
    });
  });

  test("requires at least one case", () => {
    expect(ScenarioSchema.safeParse({ id: "i", title: "t", cases: [] }).success).toBe(false);
    expect(ScenarioSchema.safeParse({ id: "i", title: "t" }).success).toBe(false);
  });

  test("rejects empty required strings", () => {
    expect(ScenarioSchema.safeParse({ id: "", title: "t", cases: oneCase }).success).toBe(false);
    expect(ScenarioSchema.safeParse({ id: "i", title: "", cases: oneCase }).success).toBe(false);
  });

  test("gives an untagged scenario an empty tag list, so consumers never see undefined", () => {
    const parsed = ScenarioSchema.parse({ id: "login", title: "Login", cases: oneCase });

    expect(parsed.tags).toEqual([]);
  });

  test("keeps the tags a file declares, in the order written", () => {
    const parsed = ScenarioSchema.parse({
      id: "login",
      title: "Login",
      tags: ["smoke", "auth-2"],
      cases: oneCase,
    });

    expect(parsed.tags).toEqual(["smoke", "auth-2"]);
  });

  test("rejects a tag that is not a lowercase slug", () => {
    const bad = ["Smoke", "smoke test", "smoke_test", "-leading", ""];
    for (const tag of bad) {
      const parsed = ScenarioSchema.safeParse({
        id: "login",
        title: "Login",
        tags: [tag],
        cases: oneCase,
      });

      expect(parsed.success).toBe(false);
    }
  });
});

describe("RunStatusSchema", () => {
  test("accepts queued, so a run may exist before it has touched a device", () => {
    expect(RunStatusSchema.safeParse("queued").success).toBe(true);
  });

  test("still accepts every status written before queued existed", () => {
    for (const status of ["running", "passed", "failed", "error"]) {
      expect(RunStatusSchema.safeParse(status).success).toBe(true);
    }
  });
});

/**
 * "Has this run answered yet?" -- the question the server's startup sweep asks
 * of Firestore and the CLI's poll asks of each response. Both must agree, or a
 * state one of them stops noticing is a run the reader is shown as pending
 * forever.
 */
describe("isUnsettledRun", () => {
  test("counts a run still waiting for a device as unanswered, so a restart can close it", () => {
    expect(isUnsettledRun("queued")).toBe(true);
  });

  test("counts a run on a device as unanswered, since it has produced no verdict yet", () => {
    expect(isUnsettledRun("running")).toBe(true);
  });

  test("counts error as answered, so a poll stops waiting for a verdict nobody will give", () => {
    // The failure this guards: an abandoned run is settled to `error` at
    // startup precisely so the CLI stops waiting. Reading `error` as unanswered
    // would put the wait straight back.
    expect(isUnsettledRun("error")).toBe(false);
  });

  test("counts both verdicts as answered", () => {
    expect(isUnsettledRun("passed")).toBe(false);
    expect(isUnsettledRun("failed")).toBe(false);
  });

  test("agrees with the list the sweep queries Firestore for, so the two cannot drift", () => {
    for (const status of UNSETTLED_RUN_STATUSES) {
      expect(isUnsettledRun(status)).toBe(true);
    }
  });
});

describe("CaseStatusSchema", () => {
  test("refuses queued, because a case has no state in which it is not yet being worked on", () => {
    // Cases are created by the runner one at a time, at the moment their turn
    // comes. A `queued` case document would sit in a state nothing ever moves
    // it out of, and the reader could not tell it from a genuinely stalled one.
    expect(CaseStatusSchema.safeParse("queued").success).toBe(false);
  });

  test("accepts every state a case really passes through", () => {
    for (const status of ["running", "passed", "failed", "error"]) {
      expect(CaseStatusSchema.safeParse(status).success).toBe(true);
    }
  });

  test("keeps queued out of a stored case, which shares the run enum no longer", () => {
    const withQueuedStatus = {
      order: 0,
      title: "Logs in",
      prompt: "check that the user can log in",
      model: "gemma-4-12b",
      status: "queued",
      verdictReason: null,
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: null,
    };

    expect(
      CaseRunSchema.omit({ runId: true, caseId: true, steps: true }).safeParse(withQueuedStatus)
        .success,
    ).toBe(false);
  });
});

describe("filterByTags", () => {
  const scenario = (id: string, tags: string[]): Scenario => ({
    id,
    title: id,
    tags,
    cases: [{ id: "only", prompt: "p", maxSteps: 20 }],
  });

  const login = scenario("login", ["smoke", "android"]);
  const shop = scenario("shop", ["smoke", "web"]);
  const untagged = scenario("untagged", []);
  const all = [login, shop, untagged];

  test("returns every scenario when nothing is selected, so an untouched filter hides nothing", () => {
    expect(filterByTags(all, [])).toEqual(all);
  });

  test("keeps only the scenarios carrying all selected tags", () => {
    expect(filterByTags(all, ["smoke", "android"])).toEqual([login]);
  });

  test("narrows rather than widens as tags are added", () => {
    expect(filterByTags(all, ["smoke"])).toEqual([login, shop]);
    expect(filterByTags(all, ["smoke", "web"])).toEqual([shop]);
  });

  test("returns nothing when no scenario carries the whole selection", () => {
    expect(filterByTags(all, ["android", "web"])).toEqual([]);
  });

  test("drops untagged scenarios as soon as any tag is selected", () => {
    expect(filterByTags(all, ["smoke"])).not.toContain(untagged);
  });
});

describe("collectTags", () => {
  const scenario = (id: string, tags: string[]): Scenario => ({
    id,
    title: id,
    tags,
    cases: [{ id: "only", prompt: "p", maxSteps: 20 }],
  });

  test("lists each tag once however many scenarios use it", () => {
    const tags = collectTags([scenario("login", ["smoke", "auth"]), scenario("shop", ["smoke"])]);

    expect(tags).toEqual(["auth", "smoke"]);
  });

  test("sorts lexicographically, so the chip row does not reshuffle when a scenario is added", () => {
    const before = collectTags([scenario("shop", ["web", "regression"])]);
    const after = collectTags([
      scenario("shop", ["web", "regression"]),
      scenario("login", ["android"]),
    ]);

    expect(before).toEqual(["regression", "web"]);
    expect(after).toEqual(["android", "regression", "web"]);
  });

  test("returns nothing when no scenario is tagged", () => {
    expect(collectTags([scenario("login", []), scenario("shop", [])])).toEqual([]);
  });
});

describe("describeTarget", () => {
  test("names an android target by package, with the activity when there is one", () => {
    expect(describeTarget({ platform: "android", package: "com.example" })).toBe("com.example");
    expect(describeTarget({ platform: "android", package: "com.example", activity: ".Main" })).toBe(
      "com.example/.Main",
    );
  });

  test("names a web target by its url", () => {
    expect(describeTarget({ platform: "web", url: "http://localhost:5174" })).toBe(
      "http://localhost:5174",
    );
  });
});

describe("resolveModel", () => {
  const fallback = "env-model";

  test("prefers the case's model over the scenario's", () => {
    expect(resolveModel({ model: "case" }, { model: "scenario" }, fallback)).toBe("case");
  });

  test("falls back to the scenario's model when the case has none", () => {
    expect(resolveModel({}, { model: "scenario" }, fallback)).toBe("scenario");
  });

  test("falls back to the process default when neither names one", () => {
    expect(resolveModel({}, {}, fallback)).toBe(fallback);
  });
});
