import { describe, expect, test } from "bun:test";
import { isDecisionModel, listModels } from "./models.ts";

const BASE_URL = "http://localhost:1234/v1";

function respond(body: unknown, status = 200) {
  return async () => new Response(JSON.stringify(body), { status });
}

describe("isDecisionModel", () => {
  test("keeps chat models", () => {
    expect(isDecisionModel("gemma-4-26b-a4b-it-qat-mlx")).toBe(true);
  });

  test("drops embedding models whatever their casing", () => {
    expect(isDecisionModel("text-embedding-nomic-embed-text-v1.5")).toBe(false);
    expect(isDecisionModel("Nomic-Embedding-v2")).toBe(false);
  });
});

describe("listModels", () => {
  test("returns the ids the endpoint reports, sorted", async () => {
    const models = await listModels({
      baseURL: BASE_URL,
      fetch: respond({ data: [{ id: "zeta" }, { id: "alpha" }] }),
    });

    expect(models.map((m) => m.id)).toEqual(["alpha", "zeta"]);
  });

  test("filters out embedding models", async () => {
    const models = await listModels({
      baseURL: BASE_URL,
      fetch: respond({
        data: [{ id: "gemma-4-e4b" }, { id: "text-embedding-nomic-embed-text-v1.5" }],
      }),
    });

    expect(models.map((m) => m.id)).toEqual(["gemma-4-e4b"]);
  });

  test("ignores entries with no usable id", async () => {
    const models = await listModels({
      baseURL: BASE_URL,
      fetch: respond({ data: [{ id: "" }, { id: 7 }, {}, { id: "ok" }] }),
    });

    expect(models.map((m) => m.id)).toEqual(["ok"]);
  });

  test("returns an empty list when the endpoint reports no models", async () => {
    expect(await listModels({ baseURL: BASE_URL, fetch: respond({}) })).toEqual([]);
  });

  test("throws when the endpoint answers with an error status", async () => {
    await expect(
      listModels({ baseURL: BASE_URL, fetch: respond({ error: "nope" }, 500) }),
    ).rejects.toThrow(/500/);
  });

  test("appends /models without doubling a trailing slash", async () => {
    const seen: string[] = [];

    await listModels({
      baseURL: "http://localhost:1234/v1/",
      fetch: async (url) => {
        seen.push(url);
        return new Response(JSON.stringify({ data: [] }));
      },
    });

    expect(seen).toEqual(["http://localhost:1234/v1/models"]);
  });
});
