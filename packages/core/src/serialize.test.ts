import { describe, expect, test } from "bun:test";
import type { UiNode } from "./schema.ts";
import { centerOf, serializeForLlm } from "./serialize.ts";

/**
 * Builds a node without stating the fields a case does not care about. The
 * defaults are the unremarkable ones -- visible, enabled, inert -- so each test
 * reads as only what it is actually about.
 */
function node(overrides: Partial<UiNode> = {}): UiNode {
  return {
    text: "",
    resourceId: "",
    className: "",
    contentDesc: "",
    bounds: { x1: 0, y1: 0, x2: 100, y2: 40 },
    clickable: false,
    enabled: true,
    focused: false,
    children: [],
    ...overrides,
  };
}

describe("centerOf", () => {
  test("returns the midpoint", () => {
    expect(centerOf({ x1: 60, y1: 500, x2: 1020, y2: 640 })).toEqual({ x: 540, y: 570 });
  });

  test("floors a fractional midpoint so the tap stays inside the rect", () => {
    expect(centerOf({ x1: 0, y1: 0, x2: 3, y2: 5 })).toEqual({ x: 1, y: 2 });
  });
});

/**
 * The serializer is the one piece both platforms share, so what matters here is
 * that it reads a `UiNode` without caring which of them produced it. These
 * cases are written in the DOM vocabulary a web driver emits; the adb package's
 * suite covers the same code driven by a real uiautomator dump.
 */
describe("serializeForLlm: platform-neutral", () => {
  test("numbers a DOM-shaped tree the same way it numbers a uiautomator one", () => {
    const { text, refs } = serializeForLlm(
      node({
        className: "main",
        children: [
          node({ className: "h1", text: "Sign in" }),
          node({
            className: "input",
            resourceId: "email",
            contentDesc: "Email",
            bounds: { x1: 0, y1: 40, x2: 200, y2: 80 },
          }),
          node({
            className: "button",
            text: "Continue",
            clickable: true,
            bounds: { x1: 0, y1: 80, x2: 200, y2: 120 },
          }),
        ],
      }),
    );

    expect(refs.size).toBe(2);
    expect(text).toContain('[0] input desc="Email" id=email editable');
    expect(text).toContain('[1] button text="Continue"');
  });

  test("treats an <input> as editable even though nothing marks it clickable", () => {
    // The web counterpart of uiautomator's unclickable EditText: a field the
    // model must be able to target, which no `clickable` flag announces.
    const { refs } = serializeForLlm(node({ className: "input", resourceId: "email" }));

    expect(refs.size).toBe(1);
  });

  test("treats a <textarea> and a contenteditable as editable too", () => {
    const { refs } = serializeForLlm(
      node({
        className: "form",
        children: [
          node({ className: "textarea", resourceId: "notes" }),
          node({
            className: "contenteditable",
            resourceId: "body",
            bounds: { x1: 0, y1: 40, x2: 100, y2: 80 },
          }),
        ],
      }),
    );

    expect([...refs.values()].map((r) => r.node.resourceId)).toEqual(["notes", "body"]);
  });

  test("does not mistake a class merely containing 'input' for a field", () => {
    // `input-group` is a wrapper, not a field. Anchoring the web half of the
    // pattern is what keeps a container off the ref list.
    const { refs } = serializeForLlm(node({ className: "input-group", resourceId: "wrap" }));

    expect(refs.size).toBe(0);
  });

  test("leaves an unprefixed id and an unqualified tag name alone", () => {
    // Both shorteners exist for Android's `pkg:id/leaf` and `a.b.Class`; on a
    // DOM node they must be the identity rather than eat the value.
    const { text } = serializeForLlm(
      node({ className: "button", resourceId: "submit", text: "Go", clickable: true }),
    );

    expect(text).toContain("button");
    expect(text).toContain("id=submit");
  });

  test("resolves a ref to the element's centre, which is where a click lands", () => {
    const { refs } = serializeForLlm(
      node({ className: "button", clickable: true, bounds: { x1: 10, y1: 20, x2: 110, y2: 60 } }),
    );

    expect(refs.get(0)?.center).toEqual({ x: 60, y: 40 });
  });

  test("keeps a disabled control visible but unnumbered", () => {
    const { text, refs } = serializeForLlm(
      node({ className: "button", text: "Pay", clickable: true, enabled: false }),
    );

    expect(refs.size).toBe(0);
    expect(text).toContain("disabled");
  });

  test("drops zero-area nodes", () => {
    const { text } = serializeForLlm(
      node({
        className: "main",
        children: [
          node({ className: "span", text: "hidden", bounds: { x1: 0, y1: 0, x2: 0, y2: 0 } }),
          node({ className: "span", text: "shown" }),
        ],
      }),
    );

    expect(text).not.toContain("hidden");
    expect(text).toContain("shown");
  });

  test("collapses wrappers that hold one child and say nothing themselves", () => {
    const { text } = serializeForLlm(
      node({
        className: "div",
        children: [node({ className: "div", children: [node({ className: "p", text: "Hi" })] })],
      }),
    );

    expect(text).toBe('p text="Hi"');
  });

  test("omits a desc that merely repeats the text", () => {
    const { text } = serializeForLlm(
      node({ className: "button", text: "OK", contentDesc: "OK", clickable: true }),
    );

    expect(text).toContain('text="OK"');
    expect(text).not.toContain("desc=");
  });

  test("returns an empty text and no refs for an entirely off-screen tree", () => {
    const { text, refs } = serializeForLlm(node({ bounds: { x1: 0, y1: 0, x2: 0, y2: 0 } }));

    expect(text).toBe("");
    expect(refs.size).toBe(0);
  });
});
