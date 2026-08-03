// The serializer itself lives in core, which cannot depend on this package.
// These cases stay here because they drive it through `parseUiDump`, so what
// they actually pin down is that a real uiautomator dump renders the way the
// model expects. The platform-neutral cases live in core's own suite.
import { describe, expect, test } from "bun:test";
import { serializeForLlm } from "@gemma-e2e/core";
import { parseUiDump } from "./parse.ts";
import { LIST_SCREEN_XML, LOGIN_SCREEN_XML } from "./fixtures.ts";

describe("serializeForLlm: login screen", () => {
  const { text, refs } = serializeForLlm(parseUiDump(LOGIN_SCREEN_XML));
  const lines = text.split("\n");

  test("numbers exactly the enabled, actionable elements", () => {
    // Both fields, the checkbox, and the "Forgot password?" link -- but not the
    // disabled Sign in button, and not the static title.
    expect(refs.size).toBe(4);
    expect([...refs.keys()]).toEqual([0, 1, 2, 3]);
  });

  test("assigns refs in top-to-bottom document order", () => {
    expect(refs.get(0)?.node.resourceId).toBe("com.example.app:id/email");
    expect(refs.get(1)?.node.resourceId).toBe("com.example.app:id/password");
    expect(refs.get(2)?.node.resourceId).toBe("com.example.app:id/remember");
    expect(refs.get(3)?.node.resourceId).toBe("com.example.app:id/forgot");
  });

  test("resolves each ref to the element's centre point", () => {
    expect(refs.get(0)?.center).toEqual({ x: 540, y: 570 });
    expect(refs.get(2)?.center).toEqual({ x: 280, y: 940 });
  });

  test("keeps a disabled control visible but unnumbered", () => {
    const submit = lines.find((line) => line.includes("Sign in"));
    expect(submit).toContain("disabled");
    expect(submit).not.toMatch(/\[\d+\]/);
  });

  test("shortens resource ids and class names", () => {
    expect(text).toContain("id=email");
    expect(text).not.toContain("com.example.app:id/email");
    expect(text).toContain("EditText");
    expect(text).not.toContain("android.widget.EditText");
  });

  test("marks text fields editable and surfaces focus", () => {
    const email = lines.find((line) => line.includes("id=email"));
    expect(email).toContain("editable");
    expect(email).toContain("focused");
  });

  test("reports checked only for checkable elements", () => {
    expect(lines.find((line) => line.includes("id=remember"))).toContain("checked=false");
    expect(lines.find((line) => line.includes("id=title"))).not.toContain("checked");
  });

  test("includes text and content-desc", () => {
    expect(text).toContain('text="Welcome back"');
    expect(text).toContain('desc="Email address"');
  });

  test("drops zero-area nodes", () => {
    expect(text).not.toContain("id=spacer");
  });

  test("collapses single-child layout wrappers", () => {
    // FrameLayout -> LinearLayout is a pure wrapper chain; only one survives.
    expect(lines[0]).not.toContain("FrameLayout");
    expect(text).not.toContain("android.widget.FrameLayout");
  });
});

describe("serializeForLlm: list screen", () => {
  const { text, refs } = serializeForLlm(parseUiDump(LIST_SCREEN_XML));

  test("numbers toolbar buttons, rows, and per-row controls", () => {
    expect(refs.size).toBe(6);
  });

  test("treats a clickable row container as a target", () => {
    expect(refs.get(2)?.node.className).toBe("android.widget.LinearLayout");
    expect(refs.get(2)?.center).toEqual({ x: 540, y: 410 });
  });

  test("distinguishes the two rows' star states", () => {
    expect(refs.get(3)?.node.checked).toBe(true);
    expect(refs.get(5)?.node.checked).toBe(false);
  });

  test("keeps row text as children of the row, not the toolbar", () => {
    const lines = text.split("\n");
    const rowIndex = lines.findIndex((line) => line.includes("[2]"));
    const titleIndex = lines.findIndex((line) => line.includes("Weekly report"));
    expect(titleIndex).toBeGreaterThan(rowIndex);
    const indentOf = (line: string) => line.length - line.trimStart().length;
    expect(indentOf(lines[titleIndex] as string)).toBeGreaterThan(
      indentOf(lines[rowIndex] as string),
    );
  });

  test("identifies icon-only buttons by content-desc", () => {
    expect(refs.get(0)?.node.contentDesc).toBe("Navigate up");
    expect(refs.get(1)?.node.contentDesc).toBe("Search");
  });
});

describe("serializeForLlm: edge cases", () => {
  test("returns an empty text and no refs for an entirely off-screen tree", () => {
    const tree = parseUiDump('<hierarchy><node bounds="[0,0][0,0]" /></hierarchy>');
    const { text, refs } = serializeForLlm(tree);
    expect(text).toBe("");
    expect(refs.size).toBe(0);
  });

  test("omits a redundant desc that merely repeats the text", () => {
    const tree = parseUiDump(
      '<hierarchy><node class="android.widget.Button" text="OK" content-desc="OK" clickable="true" enabled="true" bounds="[0,0][100,50]" /></hierarchy>',
    );
    const { text } = serializeForLlm(tree);
    expect(text).toContain('text="OK"');
    expect(text).not.toContain("desc=");
  });
});
