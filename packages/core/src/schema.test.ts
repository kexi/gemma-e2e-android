import { describe, expect, test } from "bun:test";
import { ActionSchema, ScenarioSchema, UiNodeSchema } from "./schema.ts";

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

describe("ScenarioSchema", () => {
  test("defaults maxSteps when the file omits it", () => {
    const parsed = ScenarioSchema.parse({
      id: "login",
      title: "Login",
      prompt: "check that the user can log in",
    });
    expect(parsed.maxSteps).toBe(20);
  });

  test("keeps an explicit maxSteps and optional app block", () => {
    const parsed = ScenarioSchema.parse({
      id: "login",
      title: "Login",
      prompt: "log in",
      app: { package: "com.example", activity: ".MainActivity" },
      maxSteps: 5,
    });
    expect(parsed.maxSteps).toBe(5);
    expect(parsed.app?.activity).toBe(".MainActivity");
  });

  test("rejects empty required strings", () => {
    expect(ScenarioSchema.safeParse({ id: "", title: "t", prompt: "p" }).success).toBe(false);
    expect(ScenarioSchema.safeParse({ id: "i", title: "t", prompt: "" }).success).toBe(false);
  });

  test("rejects a non-positive maxSteps", () => {
    expect(
      ScenarioSchema.safeParse({ id: "i", title: "t", prompt: "p", maxSteps: 0 }).success,
    ).toBe(false);
  });
});
