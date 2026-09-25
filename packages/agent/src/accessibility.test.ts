import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AccessibilityReviewReportSchema } from "@gemma-e2e/core";
import { createAccessibilityReviewer, type AccessibilityGenerateFn } from "./accessibility.ts";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
const personas = [{ id: "low-vision", label: "低視力", description: "小さい文字を読みづらい" }];
const report = { reviews: [{ personaId: "low-vision", findings: [] }] };
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function input() {
  const directory = await mkdtemp(join(tmpdir(), "accessibility-review-"));
  directories.push(directory);
  const screenshotPath = join(directory, "screen.png");
  await writeFile(screenshotPath, Buffer.from(png, "base64"));
  return { model: "gemma-test", screenshotPath, personas };
}

function response(value: unknown) {
  return {
    id: "completion-1",
    object: "chat.completion",
    created: 1,
    model: "gemma-test",
    choices: [
      {
        index: 0,
        finish_reason: "tool_calls",
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: {
                name: "report_accessibility",
                arguments: JSON.stringify(value),
              },
            },
          ],
        },
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

describe("accessibility image reviewer", () => {
  test("does not retry an HTTP server error", async () => {
    let requests = 0;
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch() {
        requests++;
        return Response.json(
          { error: { message: "service unavailable", type: "server_error" } },
          { status: 503 },
        );
      },
    });
    try {
      const review = createAccessibilityReviewer({ baseURL: `${server.url}v1`, timeoutMs: 5_000 });
      await expect(review(await input())).rejects.toThrow();
      expect(requests).toBe(1);
    } finally {
      server.stop(true);
    }
  });

  test.each([
    { name: "report_accessibility", arguments: "{}" },
    { name: "report_accessibility", arguments: "{broken JSON" },
    { name: "unknown_tool", arguments: JSON.stringify(report) },
  ])("recovers from malformed HTTP tool output %j", async (invalidTool) => {
    let requests = 0;
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch() {
        requests++;
        const payload = response(report);
        const isFirstRequest = requests === 1;
        if (isFirstRequest) payload.choices[0]!.message.tool_calls[0]!.function = invalidTool;
        return Response.json(payload);
      },
    });
    try {
      const review = createAccessibilityReviewer({ baseURL: `${server.url}v1`, timeoutMs: 5_000 });
      expect(await review(await input())).toEqual(report);
      expect(requests).toBe(2);
    } finally {
      server.stop(true);
    }
  });

  test("recovers from one malformed response with a reinforced tool instruction", async () => {
    const prompts: string[] = [];
    const review = createAccessibilityReviewer({
      generate: async (request) => {
        prompts.push(JSON.stringify(request.prompt));
        return {
          toolRequests:
            prompts.length === 1 ? [] : [{ name: "report_accessibility", input: report }],
        };
      },
    });
    expect(await review(await input())).toEqual(report);
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("前回の応答は形式が不正");
  });

  test("stops after two malformed responses and does not retry transport failures", async () => {
    let malformedAttempts = 0;
    const malformed = createAccessibilityReviewer({
      generate: async () => {
        malformedAttempts++;
        return { toolRequests: [] };
      },
    });
    await expect(malformed(await input())).rejects.toThrow("exactly one");
    expect(malformedAttempts).toBe(2);
    let transportAttempts = 0;
    const unavailable = createAccessibilityReviewer({
      generate: async () => {
        transportAttempts++;
        throw new Error("HTTP 503");
      },
    });
    await expect(unavailable(await input())).rejects.toThrow("HTTP 503");
    expect(transportAttempts).toBe(1);
  });

  test("keeps one deadline across both format attempts", async () => {
    let attempts = 0;
    const signals: AbortSignal[] = [];
    const review = createAccessibilityReviewer({
      timeoutMs: 150,
      generate: async (request) => {
        attempts++;
        signals.push(request.signal);
        await Bun.sleep(90);
        return {
          toolRequests: attempts === 1 ? [] : [{ name: "report_accessibility", input: report }],
        };
      },
    });
    await expect(review(await input())).rejects.toThrow("timed out");
    expect(attempts).toBe(2);
    expect(signals[0]).toBe(signals[1]);
    expect(signals[1]?.aborted).toBe(true);
  });

  test("rejects a schema-valid report whose Japanese text exceeds the total UTF-8 budget", async () => {
    const oversized = {
      reviews: [
        {
          personaId: "low-vision",
          findings: Array.from({ length: 10 }, () => ({
            category: "text_size",
            location: "あ".repeat(1000),
            reason: "あ".repeat(2000),
            suggestion: "あ".repeat(2000),
          })),
        },
      ],
    };
    expect(AccessibilityReviewReportSchema.safeParse(oversized).success).toBe(true);
    expect(JSON.stringify(oversized).length).toBeLessThan(128 * 1024);
    expect(Buffer.byteLength(JSON.stringify(oversized), "utf8")).toBeGreaterThan(128 * 1024);
    const review = createAccessibilityReviewer({
      generate: async () => ({
        toolRequests: [{ name: "report_accessibility", input: oversized }],
      }),
    });
    await expect(review(await input())).rejects.toThrow("128 KiB");
  });

  test("sends PNG media, all persona details and a report tool through the real Genkit transport", async () => {
    const requests: Array<{
      model: string;
      tools: Array<{ function: { name: string } }>;
      tool_choice: string;
      temperature: number;
      messages: Array<{ role: string; content: unknown }>;
    }> = [];
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(request) {
        requests.push((await request.json()) as (typeof requests)[number]);
        return Response.json(response(report));
      },
    });
    try {
      const review = createAccessibilityReviewer({ baseURL: `${server.url}v1`, timeoutMs: 5_000 });
      expect(await review(await input())).toEqual(report);
      expect(requests).toHaveLength(1);
      const request = requests[0];
      expect(request?.model).toBe("gemma-test");
      expect(request?.tools[0]?.function.name).toBe("report_accessibility");
      expect(request?.tool_choice).toBe("required");
      expect(request?.temperature).toBe(0);
      const user = request?.messages.find((message) => message.role === "user");
      expect(user?.content).toContainEqual({
        type: "image_url",
        image_url: { url: `data:image/png;base64,${png}`, detail: "auto" },
      });
      expect(JSON.stringify(user?.content)).toContain("小さい文字を読みづらい");
      expect(JSON.stringify(request?.messages)).toContain("スクリーンリーダー");
    } finally {
      server.stop(true);
    }
  });

  test.each([
    { reviews: [] },
    { reviews: [{ personaId: "unknown", findings: [] }] },
    { reviews: [report.reviews[0], report.reviews[0]] },
    { reviews: [{ personaId: "low-vision", findings: [{ category: "screen_reader" }] }] },
  ])("rejects malformed or mismatched report %j", async (invalid) => {
    const generate: AccessibilityGenerateFn = async () => ({
      toolRequests: [{ name: "report_accessibility", input: invalid }],
    });
    await expect(createAccessibilityReviewer({ generate })(await input())).rejects.toThrow();
  });

  test("rejects multiple calls and unexpected tools", async () => {
    for (const toolRequests of [
      [],
      [{ name: "finish", input: report }],
      [
        { name: "report_accessibility", input: report },
        { name: "report_accessibility", input: report },
      ],
    ]) {
      await expect(
        createAccessibilityReviewer({ generate: async () => ({ toolRequests }) })(await input()),
      ).rejects.toThrow("exactly one");
    }
  });

  test("rejects an image with an invalid PNG signature before requesting the model", async () => {
    const reviewInput = await input();
    await writeFile(reviewInput.screenshotPath, "not an image");
    let called = false;
    await expect(
      createAccessibilityReviewer({
        generate: async () => {
          called = true;
          return { toolRequests: [] };
        },
      })(reviewInput),
    ).rejects.toThrow("PNG");
    expect(called).toBe(false);
  });

  test("bounds an unresponsive injected generator and signals cancellation", async () => {
    let signal: AbortSignal | undefined;
    const review = createAccessibilityReviewer({
      timeoutMs: 30,
      generate: async (request) => {
        signal = request.signal;
        return new Promise(() => {});
      },
    });
    await expect(review(await input())).rejects.toThrow("timed out");
    expect(signal?.aborted).toBe(true);
  });

  test("cancels an in-flight HTTP request when the review deadline expires", async () => {
    let connected = false;
    let disconnected = false;
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(request) {
        connected = true;
        request.signal.addEventListener("abort", () => {
          disconnected = true;
        });
        return new Promise<Response>(() => {});
      },
    });
    try {
      const review = createAccessibilityReviewer({ baseURL: `${server.url}v1`, timeoutMs: 150 });
      await expect(review(await input())).rejects.toThrow("timed out");
      for (let attempt = 0; attempt < 30 && !disconnected; attempt++) await Bun.sleep(10);
      expect(connected).toBe(true);
      expect(disconnected).toBe(true);
    } finally {
      server.stop(true);
    }
  });
});
