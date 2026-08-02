import { describe, expect, test } from "bun:test";
import { COLLECT_JS } from "./collect.ts";

/**
 * The collector runs inside the page, so nothing here typechecks it and only a
 * real browser can say whether it reads a page correctly -- that is what
 * `scripts/check.ts` is for. What these cases guard is the narrower thing a
 * unit test can guard: that the source which reaches Chrome is intact and
 * syntactically whole.
 */
describe("COLLECT_JS", () => {
  test("parses as JavaScript", () => {
    // A syntax error here would surface as a page that "returned nothing"
    // mid-run, with the actual mistake nowhere in the message.
    //
    // Parsed rather than compiled: `new Function` would build a callable out
    // of a string, and a test that does so teaches the pattern even where the
    // input is a constant from this file. The transpiler answers the only
    // question being asked -- is this syntactically whole -- and cannot run it.
    expect(() => new Bun.Transpiler({ loader: "js" }).transformSync(COLLECT_JS)).not.toThrow();
  });

  test("contains no backtick, which would truncate the source Chrome receives", () => {
    // Already cost one debugging session: a backtick in a comment closed the
    // template literal, and the collector arrived at the browser cut in half.
    expect(COLLECT_JS).not.toContain("`");
  });

  test("evaluates to a function call, so Runtime.evaluate yields the tree", () => {
    // `Runtime.evaluate` returns the value of the expression. Wrapped in an
    // IIFE it is the tree; left as a declaration it would be undefined, and
    // every dump would fail as "returned nothing where a value was expected".
    expect(COLLECT_JS.trimStart()).toStartWith("(()");
    expect(COLLECT_JS.trimEnd()).toEndWith("()");
  });

  test("reports the fields it must, so the mapping has them to read", () => {
    // Not a substitute for driving a browser -- it only catches a rename on
    // one side of the boundary, which no type connects.
    for (const field of [
      "tag",
      "id",
      "label",
      "text",
      "rect",
      "clickable",
      "editable",
      "disabled",
      "focused",
      "children",
    ]) {
      expect(COLLECT_JS).toContain(field);
    }
  });
});
