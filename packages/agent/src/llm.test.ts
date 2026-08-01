import { describe, expect, test } from "bun:test";
import { ActionSchema } from "@gemma-e2e/core";
import { createLogger, type LogEvent } from "@gemma-e2e/logger";
import {
  buildDecisionPrompt,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  GenkitLlm,
  LlmDecisionError,
  normalizeOutput,
  SYSTEM_PROMPT,
} from "./llm.ts";

describe("buildDecisionPrompt", () => {
  const input = {
    scenarioPrompt: "check that the user can log in",
    historySummary: "1. tap [1]",
    uiText: "[0] EditText id=email",
  };

  test("includes the goal, the history, and the screen", () => {
    const prompt = buildDecisionPrompt(input);

    expect(prompt).toContain("check that the user can log in");
    expect(prompt).toContain("1. tap [1]");
    expect(prompt).toContain("[0] EditText id=email");
  });

  test("marks the first step explicitly instead of leaving history blank", () => {
    const prompt = buildDecisionPrompt({ ...input, historySummary: "" });
    expect(prompt).toContain("this is the first step");
  });

  test("says so when the screen renders empty", () => {
    const prompt = buildDecisionPrompt({ ...input, uiText: "   " });
    expect(prompt).toContain("appears to be empty");
  });

  test("lists remembered facts in a section of their own, above the history", () => {
    const prompt = buildDecisionPrompt({
      ...input,
      rememberedFacts: ["confirmation code 4821", "total is 4200 JPY"],
    });

    expect(prompt).toContain("# Remembered facts");
    expect(prompt).toContain("- confirmation code 4821");
    expect(prompt).toContain("- total is 4200 JPY");
    expect(prompt.indexOf("# Remembered facts")).toBeLessThan(prompt.indexOf("# Steps so far"));
  });

  test("omits the section entirely when nothing has been remembered", () => {
    expect(buildDecisionPrompt(input)).not.toContain("Remembered facts");
    expect(buildDecisionPrompt({ ...input, rememberedFacts: [] })).not.toContain(
      "Remembered facts",
    );
  });
});

describe("SYSTEM_PROMPT", () => {
  test("names every action the schema accepts", () => {
    for (const action of [
      "tap",
      "input_text",
      "swipe",
      "key_event",
      "wait",
      "remember",
      "finish",
    ]) {
      expect(SYSTEM_PROMPT).toContain(action);
    }
  });

  test("explains both verdicts", () => {
    expect(SYSTEM_PROMPT).toContain("passed");
    expect(SYSTEM_PROMPT).toContain("failed");
  });

  test("tells the model to remember a value before leaving the screen showing it", () => {
    expect(SYSTEM_PROMPT).toContain("BEFORE the action that leaves that screen");
    expect(SYSTEM_PROMPT).toContain("once you have left");
  });
});

describe("defaults", () => {
  test("point at LM Studio and Gemma", () => {
    expect(DEFAULT_BASE_URL).toBe("http://localhost:1234/v1");
    expect(DEFAULT_MODEL).toBe("gemma-4-12b");
  });
});

describe("GenkitLlm retry policy", () => {
  const input = { scenarioPrompt: "log in", historySummary: "", uiText: "[0] Button" };

  test("returns the first schema-valid action without retrying", async () => {
    let calls = 0;
    const llm = new GenkitLlm({
      generate: async () => {
        calls++;
        return { output: { type: "tap", ref: 0 } };
      },
    });

    expect(await llm.decide(input)).toEqual({ type: "tap", ref: 0 });
    expect(calls).toBe(1);
  });

  test("retries when the model returns nothing schema-valid, then succeeds", async () => {
    let calls = 0;
    const llm = new GenkitLlm({
      generate: async () => {
        calls++;
        const isEarlyAttempt = calls < 3;
        return { output: isEarlyAttempt ? null : { type: "wait", ms: 500 } };
      },
    });

    expect(await llm.decide(input)).toEqual({ type: "wait", ms: 500 });
    expect(calls).toBe(3);
  });

  test("retries when generate throws, then succeeds", async () => {
    let calls = 0;
    const llm = new GenkitLlm({
      generate: async () => {
        calls++;
        const shouldFail = calls === 1;
        if (shouldFail) {
          throw new Error("connection reset");
        }
        return { output: { type: "key_event", key: "back" } };
      },
    });

    expect(await llm.decide(input)).toEqual({ type: "key_event", key: "back" });
    expect(calls).toBe(2);
  });

  test("gives up after three attempts by default", async () => {
    let calls = 0;
    const llm = new GenkitLlm({
      generate: async () => {
        calls++;
        return { output: null };
      },
    });

    await expect(llm.decide(input)).rejects.toBeInstanceOf(LlmDecisionError);
    expect(calls).toBe(3);
  });

  test("honours a custom attempt budget", async () => {
    let calls = 0;
    const llm = new GenkitLlm({
      maxAttempts: 5,
      generate: async () => {
        calls++;
        throw new Error("nope");
      },
    });

    await expect(llm.decide(input)).rejects.toThrow(/after 5 attempts/);
    expect(calls).toBe(5);
  });

  test("rejects output that parses as JSON but violates the action schema", async () => {
    const llm = new GenkitLlm({
      maxAttempts: 1,
      generate: async () => ({ output: { type: "teleport", ref: 0 } }),
    });

    await expect(llm.decide(input)).rejects.toBeInstanceOf(LlmDecisionError);
  });

  test("passes the built prompt and the system prompt to generate", async () => {
    let seen: { system?: unknown; prompt?: unknown } = {};
    const llm = new GenkitLlm({
      generate: async (request) => {
        seen = request;
        return { output: { type: "tap", ref: 0 } };
      },
    });

    await llm.decide({ ...input, uiText: '[0] Button text="Sign in"' });

    expect(seen.system).toBe(SYSTEM_PROMPT);
    expect(String(seen.prompt)).toContain("Sign in");
    expect(String(seen.prompt)).toContain("log in");
  });
});

describe("GenkitLlm", () => {
  test("constructs against the OpenAI-compatible plugin under Bun", () => {
    const llm = new GenkitLlm({ baseURL: "http://localhost:1234/v1", model: "gemma-4-12b" });
    expect(llm).toBeInstanceOf(GenkitLlm);
  });

  test("reads the base URL and model from the environment", () => {
    const previousUrl = process.env["LLM_BASE_URL"];
    const previousModel = process.env["LLM_MODEL"];
    process.env["LLM_BASE_URL"] = "http://127.0.0.1:9999/v1";
    process.env["LLM_MODEL"] = "gemma-4-e4b";

    try {
      expect(new GenkitLlm()).toBeInstanceOf(GenkitLlm);
    } finally {
      restoreEnv("LLM_BASE_URL", previousUrl);
      restoreEnv("LLM_MODEL", previousModel);
    }
  });

  test("gives up with LlmDecisionError once the server is unreachable", async () => {
    // Port 1 is reserved and refuses instantly, so this exercises the retry
    // path and the final error without a long timeout.
    const llm = new GenkitLlm({
      baseURL: "http://127.0.0.1:1/v1",
      model: "gemma-4-12b",
      maxAttempts: 2,
    });

    const promise = llm.decide({
      scenarioPrompt: "log in",
      historySummary: "",
      uiText: "[0] Button",
    });

    await expect(promise).rejects.toBeInstanceOf(LlmDecisionError);
    await expect(promise).rejects.toThrow(/after 2 attempts/);
  }, 30_000);
});

function restoreEnv(key: string, value: string | undefined): void {
  const wasUnset = value === undefined;
  if (wasUnset) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

describe("decision timing", () => {
  const input = { scenarioPrompt: "log in", historySummary: "", uiText: "[0] Button" };

  /** Captures NDJSON lines the way a stderr consumer would read them back. */
  function capture() {
    const lines: string[] = [];
    return {
      logger: createLogger({ sink: (line) => lines.push(line), level: "debug" }),
      events: () => lines.map((line) => JSON.parse(line) as LogEvent),
    };
  }

  /** Advances by a fixed amount on every read, so a call costs exactly `step`. */
  function steppingClock(step: number) {
    let value = 0;
    return () => {
      const current = value;
      value += step;
      return current;
    };
  }

  test("reports how long a successful decision took, with the model and attempt", async () => {
    const log = capture();
    const llm = new GenkitLlm({
      model: "gemma-4-e4b",
      logger: log.logger,
      clock: steppingClock(1_500),
      generate: async () => ({ output: { type: "tap", ref: 0 } }),
    });

    await llm.decide(input);

    expect(log.events().find((e) => e.event === "llm.decided")).toMatchObject({
      level: "info",
      attempt: 1,
      model: "gemma-4-e4b",
      durationMs: 1_500,
      type: "tap",
    });
  });

  test("measures with a real clock when none is injected", async () => {
    const log = capture();
    const llm = new GenkitLlm({
      logger: log.logger,
      generate: async () => ({ output: { type: "wait", ms: 10 } }),
    });

    await llm.decide(input);

    const decided = log.events().find((e) => e.event === "llm.decided");
    expect(typeof decided?.["durationMs"]).toBe("number");
    expect(decided?.["durationMs"] as number).toBeGreaterThanOrEqual(0);
  });

  test("times each attempt on its own rather than the whole decision", async () => {
    const log = capture();
    let calls = 0;
    const llm = new GenkitLlm({
      logger: log.logger,
      clock: steppingClock(200),
      generate: async () => {
        calls++;
        const isFirstAttempt = calls === 1;
        return { output: isFirstAttempt ? null : { type: "key_event", key: "back" } };
      },
    });

    await llm.decide(input);

    const events = log.events();
    expect(events.find((e) => e.event === "llm.attempt_failed")).toMatchObject({
      attempt: 1,
      durationMs: 200,
    });
    // Attempt 2 is timed from its own start, not from the decision's.
    expect(events.find((e) => e.event === "llm.decided")).toMatchObject({
      attempt: 2,
      durationMs: 200,
    });
  });

  test("reports a duration for an attempt that threw", async () => {
    const log = capture();
    const llm = new GenkitLlm({
      maxAttempts: 1,
      logger: log.logger,
      clock: steppingClock(900),
      generate: async () => {
        throw new Error("connection reset");
      },
    });

    await expect(llm.decide(input)).rejects.toBeInstanceOf(LlmDecisionError);

    expect(log.events().find((e) => e.event === "llm.attempt_failed")).toMatchObject({
      level: "warn",
      durationMs: 900,
      error: "connection reset",
    });
  });
});

describe("normalizeOutput", () => {
  const action = { type: "tap", ref: 0 };

  test("unwraps an action the model wrapped in a one-element anyOf", () => {
    expect(normalizeOutput({ anyOf: [action] })).toEqual(action);
  });

  test("unwraps a one-element oneOf the same way", () => {
    expect(normalizeOutput({ oneOf: [action] })).toEqual(action);
  });

  test("leaves an envelope listing several branches alone", () => {
    const listed = { anyOf: [action, { type: "wait", ms: 500 }] };
    expect(normalizeOutput(listed)).toEqual(listed);
  });

  test("leaves an empty envelope alone", () => {
    expect(normalizeOutput({ anyOf: [] })).toEqual({ anyOf: [] });
  });

  test("leaves a plain action untouched", () => {
    expect(normalizeOutput(action)).toEqual(action);
  });

  test("leaves an envelope key that shares the object with other keys alone", () => {
    const mixed = { anyOf: [action], type: "tap" };
    expect(normalizeOutput(mixed)).toEqual(mixed);
  });

  test("passes non-objects through", () => {
    expect(normalizeOutput(null)).toBeNull();
    expect(normalizeOutput("tap")).toBe("tap");
    expect(normalizeOutput([action])).toEqual([action]);
  });
});

describe("GenkitLlm schema-envelope tolerance", () => {
  const input = { scenarioPrompt: "log in", historySummary: "", uiText: "[0] Button" };

  test("accepts an action wrapped in a one-element anyOf without retrying", async () => {
    let calls = 0;
    const llm = new GenkitLlm({
      generate: async () => {
        calls++;
        return { output: { anyOf: [{ type: "input_text", ref: 1, text: "demo@example.com" }] } };
      },
    });

    expect(await llm.decide(input)).toEqual({
      type: "input_text",
      ref: 1,
      text: "demo@example.com",
    });
    expect(calls).toBe(1);
  });

  test("still fails when the envelope holds more than one branch", async () => {
    const llm = new GenkitLlm({
      maxAttempts: 1,
      generate: async () => ({
        output: {
          anyOf: [
            { type: "tap", ref: 0 },
            { type: "wait", ms: 500 },
          ],
        },
      }),
    });

    await expect(llm.decide(input)).rejects.toBeInstanceOf(LlmDecisionError);
  });

  test("still fails when the unwrapped content violates the schema", async () => {
    const llm = new GenkitLlm({
      maxAttempts: 1,
      generate: async () => ({ output: { anyOf: [{ type: "teleport", ref: 0 }] } }),
    });

    await expect(llm.decide(input)).rejects.toBeInstanceOf(LlmDecisionError);
  });
});

describe("SYSTEM_PROMPT envelope guidance", () => {
  test("tells the model not to echo the schema back", () => {
    expect(SYSTEM_PROMPT).toContain("anyOf");
    expect(SYSTEM_PROMPT).toContain("oneOf");
  });
});

describe("ActionSchema as structured output", () => {
  test("accepts what the system prompt tells the model to emit", () => {
    const examples = [
      { type: "tap", ref: 0 },
      { type: "input_text", ref: 1, text: "kei@example.com" },
      { type: "swipe", direction: "up" },
      { type: "key_event", key: "back" },
      { type: "wait", ms: 1000 },
      { type: "finish", verdict: "passed", reason: "done" },
    ];

    for (const example of examples) {
      expect(ActionSchema.safeParse(example).success).toBe(true);
    }
  });
});
