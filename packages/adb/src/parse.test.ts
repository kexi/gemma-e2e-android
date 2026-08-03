import { describe, expect, test } from "bun:test";
import { parseBounds, parseUiDump, UiDumpParseError } from "./parse.ts";
import { LIST_SCREEN_XML, LOGIN_SCREEN_XML } from "./fixtures.ts";

describe("parseBounds", () => {
  test("reads the two corner pairs", () => {
    expect(parseBounds("[60,500][1020,640]")).toEqual({ x1: 60, y1: 500, x2: 1020, y2: 640 });
  });

  test("keeps negative (off-screen) coordinates", () => {
    expect(parseBounds("[-10,-20][30,40]")).toEqual({ x1: -10, y1: -20, x2: 30, y2: 40 });
  });

  test("rejects malformed input", () => {
    expect(() => parseBounds("60,500,1020,640")).toThrow(UiDumpParseError);
    expect(() => parseBounds("[60,500]")).toThrow(UiDumpParseError);
    expect(() => parseBounds("")).toThrow(UiDumpParseError);
  });
});

describe("parseUiDump: login screen", () => {
  const tree = parseUiDump(LOGIN_SCREEN_XML);

  test("uses the single hierarchy child as the root", () => {
    expect(tree.className).toBe("android.widget.FrameLayout");
    expect(tree.bounds).toEqual({ x1: 0, y1: 0, x2: 1080, y2: 2400 });
  });

  test("reads attributes into typed fields", () => {
    const content = tree.children[0];
    const title = content?.children[0];

    expect(title?.text).toBe("Welcome back");
    expect(title?.resourceId).toBe("com.example.app:id/title");
    expect(title?.className).toBe("android.widget.TextView");
    expect(title?.clickable).toBe(false);
    expect(title?.enabled).toBe(true);
  });

  test("carries content-desc, focus, and the disabled state", () => {
    const fields = tree.children[0]?.children ?? [];
    const email = fields[1];
    const submit = fields[4];

    expect(email?.contentDesc).toBe("Email address");
    expect(email?.focused).toBe(true);
    expect(submit?.text).toBe("Sign in");
    expect(submit?.enabled).toBe(false);
  });

  test("reports checked only for checkable nodes", () => {
    const fields = tree.children[0]?.children ?? [];
    // The CheckBox is checkable, so its unchecked state is real information.
    expect(fields[3]?.checked).toBe(false);
    // A TextView also carries checked="false" in the dump, but it is noise;
    // gating on checkable="true" keeps it out of the model's prompt.
    expect(fields[0]?.checked).toBeUndefined();
  });

  test("retains zero-area nodes for the serializer to drop", () => {
    const fields = tree.children[0]?.children ?? [];
    expect(fields).toHaveLength(7);
    expect(fields[6]?.bounds).toEqual({ x1: 0, y1: 0, x2: 0, y2: 0 });
  });
});

describe("parseUiDump: list screen", () => {
  const tree = parseUiDump(LIST_SCREEN_XML);

  test("preserves nesting depth", () => {
    const list = tree.children[1];
    expect(list?.resourceId).toBe("com.example.app:id/list");
    expect(list?.children).toHaveLength(2);
    expect(list?.children[0]?.children).toHaveLength(3);
  });

  test("reads repeated rows independently", () => {
    const rows = tree.children[1]?.children ?? [];
    expect(rows[0]?.children[0]?.text).toBe("Weekly report");
    expect(rows[1]?.children[0]?.text).toBe("Invoice #42");
    expect(rows[0]?.children[2]?.checked).toBe(true);
    expect(rows[1]?.children[2]?.checked).toBe(false);
  });

  test("does not coerce numeric-looking text to a number", () => {
    const rows = tree.children[1]?.children ?? [];
    expect(typeof rows[1]?.children[0]?.text).toBe("string");
  });
});

describe("parseUiDump: malformed input", () => {
  test("rejects a dump without a hierarchy root", () => {
    expect(() => parseUiDump("<other></other>")).toThrow(UiDumpParseError);
  });

  test("rejects an empty hierarchy", () => {
    expect(() => parseUiDump('<hierarchy rotation="0"></hierarchy>')).toThrow(UiDumpParseError);
  });

  test("rejects a node with no bounds", () => {
    expect(() => parseUiDump('<hierarchy><node index="0" text="x" /></hierarchy>')).toThrow(
      UiDumpParseError,
    );
  });

  test("synthesises a root spanning several top-level nodes", () => {
    const tree = parseUiDump(
      '<hierarchy><node bounds="[0,0][100,100]" /><node bounds="[50,200][300,400]" /></hierarchy>',
    );
    expect(tree.className).toBe("hierarchy");
    expect(tree.bounds).toEqual({ x1: 0, y1: 0, x2: 300, y2: 400 });
    expect(tree.children).toHaveLength(2);
  });
});
