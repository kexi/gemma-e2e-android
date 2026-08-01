import { describe, expect, test } from "bun:test";
import {
  ActionSchema,
  resolveModel,
  ScenarioSchema,
  TestCaseSchema,
  UiNodeSchema,
} from "./schema.ts";

describe("ActionSchema", () => {
  test("accepts every action variant", () => {
    const actions = [
      { type: "tap", ref: 0 },
      { type: "input_text", ref: 3, text: "hunter2" },
      { type: "swipe", direction: "up" },
      { type: "key_event", key: "back" },
      { type: "wait", ms: 500 },
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

  test("accepts a scenario with an app block and a default model", () => {
    const parsed = ScenarioSchema.parse({
      id: "login",
      title: "Login",
      app: { package: "com.example", activity: ".MainActivity" },
      model: "gemma-4-12b",
      cases: oneCase,
    });

    expect(parsed.app?.activity).toBe(".MainActivity");
    expect(parsed.model).toBe("gemma-4-12b");
    expect(parsed.cases).toHaveLength(1);
  });

  test("requires at least one case", () => {
    expect(ScenarioSchema.safeParse({ id: "i", title: "t", cases: [] }).success).toBe(false);
    expect(ScenarioSchema.safeParse({ id: "i", title: "t" }).success).toBe(false);
  });

  test("rejects empty required strings", () => {
    expect(ScenarioSchema.safeParse({ id: "", title: "t", cases: oneCase }).success).toBe(false);
    expect(ScenarioSchema.safeParse({ id: "i", title: "", cases: oneCase }).success).toBe(false);
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
