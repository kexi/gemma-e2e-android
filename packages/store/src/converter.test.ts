import { describe, expect, test } from "bun:test";
import type { QueryDocumentSnapshot } from "firebase-admin/firestore";
import { z } from "zod";
import { ConverterError, zodConverter } from "./converter.ts";

const Schema = z.object({
  title: z.string(),
  count: z.number().int(),
  note: z.string().nullable(),
  tag: z.string().default("none"),
});

const converter = zodConverter(Schema, "widget");

/** The two members of QueryDocumentSnapshot the converter actually touches. */
function snapshot(data: unknown, path = "widgets/w1"): QueryDocumentSnapshot {
  return { data: () => data, ref: { path } } as unknown as QueryDocumentSnapshot;
}

describe("toFirestore", () => {
  test("passes a valid document through", () => {
    const value = { title: "t", count: 1, note: null, tag: "x" };

    expect(converter.toFirestore(value)).toEqual(value);
  });

  test("applies schema defaults so the stored document is complete", () => {
    const written = converter.toFirestore({ title: "t", count: 1, note: null } as never);

    expect(written["tag"]).toBe("none");
  });

  test("strips keys the schema does not declare", () => {
    const written = converter.toFirestore({
      title: "t",
      count: 1,
      note: null,
      secret: "leaked",
    } as never);

    expect(written).not.toHaveProperty("secret");
  });

  test("refuses to write a document that fails validation", () => {
    expect(() => converter.toFirestore({ title: "t", count: 1.5, note: null } as never)).toThrow(
      ConverterError,
    );
  });

  test("names the offending field in the error", () => {
    expect(() => converter.toFirestore({ title: 7, count: 1, note: null } as never)).toThrow(
      /title/,
    );
  });
});

describe("fromFirestore", () => {
  test("parses a valid document", () => {
    const value = { title: "t", count: 1, note: "n", tag: "x" };

    expect(converter.fromFirestore(snapshot(value))).toEqual(value);
  });

  test("rejects a document that drifted from the schema", () => {
    expect(() => converter.fromFirestore(snapshot({ title: "t" }))).toThrow(ConverterError);
  });

  test("names the document path so a corrupt row is findable", () => {
    expect(() => converter.fromFirestore(snapshot({}, "runs/r1/cases/c1"))).toThrow(
      /runs\/r1\/cases\/c1/,
    );
  });

  test("reports the label given at construction", () => {
    expect(() => converter.fromFirestore(snapshot({}))).toThrow(/widget/);
  });
});
