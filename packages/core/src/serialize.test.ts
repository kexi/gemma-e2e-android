import { describe, expect, test } from "bun:test";
import type { UiNode } from "./schema.ts";
import { centerOf, serializeAsXml, serializeForLlm, serializeUi } from "./serialize.ts";

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

describe("serializeAsXml", () => {
  const tree = node({
    className: "android.widget.FrameLayout",
    bounds: { x1: 0, y1: 0, x2: 1080, y2: 2400 },
    children: [
      node({
        className: "android.widget.Button",
        text: "Login",
        resourceId: "com.example:id/loginButton",
        contentDesc: "Login button",
        bounds: { x1: 63, y1: 1293, x2: 1017, y2: 1419 },
        clickable: true,
      }),
      node({
        className: "android.widget.CheckBox",
        text: "Remember me",
        bounds: { x1: 63, y1: 1450, x2: 400, y2: 1500 },
        clickable: true,
        checked: false,
      }),
    ],
  });

  test("renders every field in uiautomator's spelling, nesting children under their parent", () => {
    expect(serializeAsXml(tree).text).toBe(
      [
        '<node ref="0" text="" resource-id="" class="android.widget.FrameLayout" content-desc="" clickable="false" enabled="true" focused="false" bounds="[0,0][1080,2400]">',
        '  <node ref="1" text="Login" resource-id="com.example:id/loginButton" class="android.widget.Button" content-desc="Login button" clickable="true" enabled="true" focused="false" bounds="[63,1293][1017,1419]" />',
        '  <node ref="2" text="Remember me" resource-id="" class="android.widget.CheckBox" content-desc="" checked="false" clickable="true" enabled="true" focused="false" bounds="[63,1450][400,1500]" />',
        "</node>",
      ].join("\n"),
    );
  });

  test("writes checked only on nodes that have the state, never uiautomator's sibling index", () => {
    const { text } = serializeAsXml(tree);

    expect(text.match(/checked=/g)).toHaveLength(1);
    expect(text).not.toContain("index=");
  });

  test("writes the optional uiautomator fields in its spelling when the tree has them", () => {
    const { text } = serializeAsXml(
      node({
        package: "com.example",
        checkable: true,
        checked: true,
        focusable: true,
        scrollable: false,
        longClickable: true,
        password: true,
        selected: false,
      }),
    );

    expect(text).toBe(
      '<node ref="0" text="" resource-id="" class="" package="com.example" content-desc="" checkable="true" checked="true" clickable="false" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="true" password="true" selected="false" bounds="[0,0][100,40]" />',
    );
  });

  test("numbers every node in document order, including inert and zero-area ones", () => {
    const { text, refs } = serializeAsXml(
      node({
        className: "root",
        children: [
          node({ className: "wrapper", children: [node({ className: "a", clickable: true })] }),
          node({ className: "hidden", bounds: { x1: 5, y1: 5, x2: 5, y2: 5 } }),
          node({ className: "b" }),
        ],
      }),
    );

    // Pre-order: a parent before its children, and a subtree before its next sibling.
    expect([...refs.values()].map((one) => one.node.className)).toEqual([
      "root",
      "wrapper",
      "a",
      "hidden",
      "b",
    ]);
    expect([...refs.keys()]).toEqual([0, 1, 2, 3, 4]);
    expect(text).toContain('<node ref="3" text="" resource-id="" class="hidden"');
    expect(text).toContain('bounds="[5,5][5,5]"');
  });

  test("maps every ref to the centre of the node it names", () => {
    const { refs } = serializeAsXml(tree);

    expect(refs.size).toBe(3);
    expect(refs.get(0)?.center).toEqual({ x: 540, y: 1200 });
    expect(refs.get(1)).toMatchObject({ ref: 1, center: { x: 540, y: 1356 } });
    expect(refs.get(1)?.node.text).toBe("Login");
    expect(refs.get(2)?.center).toEqual({ x: 231, y: 1475 });
  });

  test("escapes markup, quotes and line breaks so every attribute reads back verbatim", () => {
    const { text } = serializeAsXml(
      node({ text: 'Tom & "Jerry" <b>\'s</b>', contentDesc: "line one\nline two\ttab\r" }),
    );

    expect(text).toContain('text="Tom &amp; &quot;Jerry&quot; &lt;b&gt;\'s&lt;/b&gt;"');
    expect(text).toContain('content-desc="line one&#10;line two&#9;tab&#13;"');
  });

  test("replaces characters XML 1.0 cannot carry, so the document stays well-formed", () => {
    const { text } = serializeAsXml(node({ text: "a\u0000b\u001Fc\u0008d" }));

    expect(text).toContain('text="a\uFFFDb\uFFFDc\uFFFDd"');
  });
});

describe("serializeUi", () => {
  const screen = node({
    className: "main",
    children: [node({ className: "button", text: "Go", clickable: true })],
  });

  test("gives the compact numbering for text, exactly as serializeForLlm does", () => {
    expect(serializeUi(screen, "text")).toEqual(serializeForLlm(screen));
  });

  test("gives the full tree for xml, exactly as serializeAsXml does", () => {
    expect(serializeUi(screen, "xml")).toEqual(serializeAsXml(screen));
  });
});
