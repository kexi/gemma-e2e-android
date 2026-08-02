import { describe, expect, test } from "bun:test";
import { serializeForLlm } from "@gemma-e2e/core";
import { DomWalkError, type RawElement, type RawTree, toUiNode } from "./dom-walker.ts";

/** A reported element, stating only what a case is actually about. */
function raw(overrides: Partial<RawElement> = {}): RawElement {
  return {
    tag: "div",
    id: "",
    label: "",
    text: "",
    rect: { x: 0, y: 0, width: 100, height: 40 },
    clickable: false,
    editable: false,
    disabled: false,
    focused: false,
    children: [],
    ...overrides,
  };
}

/** Wraps elements into a tree whose roots are the indices given. */
function tree(elements: RawElement[], roots = [0]): RawTree {
  return { elements, roots };
}

describe("toUiNode", () => {
  test("carries the tag as the class name and the id as the resource id", () => {
    const node = toUiNode(tree([raw({ tag: "button", id: "submit" })]));

    expect(node.className).toBe("button");
    expect(node.resourceId).toBe("submit");
  });

  test("turns a rect into the bounds the serializer measures from", () => {
    const node = toUiNode(tree([raw({ rect: { x: 10, y: 20, width: 100, height: 40 } })]));

    expect(node.bounds).toEqual({ x1: 10, y1: 20, x2: 110, y2: 60 });
  });

  test("rounds fractional coordinates, which layout routinely produces", () => {
    const node = toUiNode(tree([raw({ rect: { x: 10.4, y: 20.6, width: 99.5, height: 39.2 } })]));

    expect(node.bounds).toEqual({ x1: 10, y1: 21, x2: 110, y2: 60 });
  });

  test("reports a disabled element as not enabled", () => {
    expect(toUiNode(tree([raw({ disabled: true })])).enabled).toBe(false);
    expect(toUiNode(tree([raw()])).enabled).toBe(true);
  });

  test("keeps checked only for the elements that reported it", () => {
    expect(toUiNode(tree([raw({ checked: true })])).checked).toBe(true);
    expect(toUiNode(tree([raw({ checked: false })])).checked).toBe(false);
    expect(toUiNode(tree([raw()])).checked).toBeUndefined();
  });

  test("drops a label that merely repeats the text", () => {
    const repeated = toUiNode(tree([raw({ text: "OK", label: "OK" })]));
    const distinct = toUiNode(tree([raw({ text: "OK", label: "Confirm" })]));

    expect(repeated.contentDesc).toBe("");
    expect(distinct.contentDesc).toBe("Confirm");
  });

  test("nests children by the indices the collector reported", () => {
    const node = toUiNode(
      tree([
        raw({ tag: "form", children: [1, 2] }),
        raw({ tag: "input", id: "email" }),
        raw({ tag: "button", id: "go" }),
      ]),
    );

    expect(node.children.map((c) => c.resourceId)).toEqual(["email", "go"]);
  });

  test("reports a contenteditable div as editable, which a tag alone cannot say", () => {
    // The serializer decides editability from the class name, so a div that
    // takes typing has to arrive named for what it does rather than what it is.
    const node = toUiNode(tree([raw({ tag: "div", editable: true })]));

    expect(node.className).toBe("contenteditable");
    expect(serializeForLlm(node).refs.size).toBe(1);
  });

  test("leaves a real input's tag alone, editable though it is", () => {
    expect(toUiNode(tree([raw({ tag: "input", editable: true })])).className).toBe("input");
  });

  test("gathers several roots under one container, so nothing is lost", () => {
    const node = toUiNode(
      tree(
        [
          raw({ tag: "header", text: "Shop", rect: { x: 0, y: 0, width: 200, height: 30 } }),
          raw({ tag: "main", text: "Beans", rect: { x: 0, y: 30, width: 200, height: 100 } }),
        ],
        [0, 1],
      ),
    );

    expect(node.children.map((c) => c.className)).toEqual(["header", "main"]);
    // A zero-area container would be dropped by the serializer, taking the page
    // with it, so it has to enclose what it holds.
    expect(node.bounds).toEqual({ x1: 0, y1: 0, x2: 200, y2: 130 });
  });

  test("refuses a tree that points at an element it did not report", () => {
    expect(() => toUiNode(tree([raw({ children: [7] })]))).toThrow(DomWalkError);
  });
});

/**
 * The reason this adapter exists: a page has to arrive in the same shape a
 * device does, so that one serializer, one ref numbering, and one action
 * vocabulary serve both. These pin the whole round trip rather than the
 * mapping alone.
 */
describe("toUiNode -> serializeForLlm", () => {
  test("renders a login form the way the model already reads one", () => {
    const { text, refs } = serializeForLlm(
      toUiNode(
        tree([
          raw({
            tag: "form",
            rect: { x: 0, y: 0, width: 400, height: 200 },
            children: [1, 2, 3],
          }),
          raw({ tag: "h1", text: "Sign in", rect: { x: 0, y: 0, width: 400, height: 40 } }),
          raw({
            tag: "input",
            id: "email",
            label: "Email",
            editable: true,
            rect: { x: 0, y: 40, width: 400, height: 40 },
          }),
          raw({
            tag: "button",
            id: "go",
            text: "Continue",
            clickable: true,
            rect: { x: 0, y: 80, width: 400, height: 40 },
          }),
        ]),
      ),
    );

    expect(text).toContain('[0] input desc="Email" id=email editable');
    expect(text).toContain('[1] button text="Continue" id=go');
    expect(refs.size).toBe(2);
  });

  test("resolves a ref to the point a click has to land on", () => {
    const { refs } = serializeForLlm(
      toUiNode(
        tree([
          raw({ tag: "button", clickable: true, rect: { x: 10, y: 20, width: 100, height: 40 } }),
        ]),
      ),
    );

    expect(refs.get(0)?.center).toEqual({ x: 60, y: 40 });
  });

  test("numbers refs top-to-bottom, matching how the page is read", () => {
    const { refs } = serializeForLlm(
      toUiNode(
        tree([
          raw({ tag: "nav", rect: { x: 0, y: 0, width: 300, height: 120 }, children: [1, 2, 3] }),
          raw({ tag: "a", id: "first", text: "Beans", clickable: true }),
          raw({
            tag: "a",
            id: "second",
            text: "Cart",
            clickable: true,
            rect: { x: 0, y: 40, width: 100, height: 40 },
          }),
          raw({
            tag: "a",
            id: "third",
            text: "Account",
            clickable: true,
            rect: { x: 0, y: 80, width: 100, height: 40 },
          }),
        ]),
      ),
    );

    expect([...refs.values()].map((r) => r.node.resourceId)).toEqual(["first", "second", "third"]);
  });

  test("keeps a disabled button visible to the model but not targetable", () => {
    const { text, refs } = serializeForLlm(
      toUiNode(tree([raw({ tag: "button", text: "Pay", clickable: true, disabled: true })])),
    );

    expect(text).toContain("disabled");
    expect(refs.size).toBe(0);
  });

  test("surfaces a checkbox's state, which decides whether it needs clicking", () => {
    const { text } = serializeForLlm(
      toUiNode(tree([raw({ tag: "input", id: "terms", clickable: true, checked: false })])),
    );

    expect(text).toContain("checked=false");
  });
});
