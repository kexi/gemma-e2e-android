import { describe, expect, test } from "bun:test";
import { uiFormatChoiceOf, uiFormatFieldOf } from "./ScenarioBuilder.tsx";

describe("screen format through the builder", () => {
  test("round-trips a saved format through the select and back into the request", () => {
    for (const format of ["text", "xml"] as const) {
      expect(uiFormatFieldOf(uiFormatChoiceOf(format))).toEqual({ uiFormat: format });
    }
  });

  test("sends no format when the select is left on inherit, so the default keeps applying", () => {
    expect(uiFormatChoiceOf(undefined)).toBe("");
    expect(uiFormatFieldOf(uiFormatChoiceOf(undefined))).toEqual({});
  });

  test("never sends a value the server schema would reject", () => {
    expect(uiFormatFieldOf("json")).toEqual({});
  });
});
