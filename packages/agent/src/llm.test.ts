import { describe, expect, test } from "bun:test";
import { ActionSchema } from "@gemma-e2e/core";
import { createLogger, type LogEvent } from "@gemma-e2e/logger";
import {
  actionFromToolRequest,
  actionTools,
  buildDecisionPrompt,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  GenkitLlm,
  LlmDecisionError,
  soleToolRequest,
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

  test("asks for exactly one tool call, since a turn is one action", () => {
    expect(SYSTEM_PROMPT).toContain("calling exactly one tool");
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

  test("returns the action the first tool call names, without retrying", async () => {
    let calls = 0;
    const llm = new GenkitLlm({
      generate: async () => {
        calls++;
        return { toolRequests: [{ name: "tap", input: { ref: 0 } }] };
      },
    });

    expect(await llm.decide(input)).toEqual({ type: "tap", ref: 0 });
    expect(calls).toBe(1);
  });

  test("retries when the model calls no tool, then succeeds", async () => {
    let calls = 0;
    const llm = new GenkitLlm({
      generate: async () => {
        calls++;
        const isEarlyAttempt = calls < 3;
        return { toolRequests: isEarlyAttempt ? [] : [{ name: "wait", input: { ms: 500 } }] };
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
        return { toolRequests: [{ name: "key_event", input: { key: "back" } }] };
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
        return { toolRequests: [] };
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

  test("rejects a tool call naming no action the schema knows", async () => {
    const llm = new GenkitLlm({
      maxAttempts: 1,
      generate: async () => ({ toolRequests: [{ name: "teleport", input: { ref: 0 } }] }),
    });

    await expect(llm.decide(input)).rejects.toBeInstanceOf(LlmDecisionError);
  });

  test("passes the built prompt and the system prompt to generate", async () => {
    let seen: { system?: unknown; prompt?: unknown } = {};
    const llm = new GenkitLlm({
      generate: async (request) => {
        seen = request;
        return { toolRequests: [{ name: "tap", input: { ref: 0 } }] };
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
      generate: async () => ({ toolRequests: [{ name: "tap", input: { ref: 0 } }] }),
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
      generate: async () => ({ toolRequests: [{ name: "wait", input: { ms: 10 } }] }),
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
        return {
          toolRequests: isFirstAttempt ? [] : [{ name: "key_event", input: { key: "back" } }],
        };
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

describe("actionTools", () => {
  test("offers one tool per action the schema accepts", () => {
    const names = actionTools().map((tool) => tool.name);

    expect(names).toEqual([
      "tap",
      "input_text",
      "swipe",
      "key_event",
      "wait",
      "remember",
      "finish",
    ]);
  });

  test("describes every tool, since the description is what the model chooses on", () => {
    for (const tool of actionTools()) {
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });

  test("leaves `type` out of the arguments, because the tool name already carries it", () => {
    const tap = actionTools().find((tool) => tool.name === "tap");

    expect(tap?.inputSchema.safeParse({ ref: 0 }).success).toBe(true);
  });

  test("keeps each variant's own constraints", () => {
    const tools = actionTools();
    const swipe = tools.find((tool) => tool.name === "swipe");
    const wait = tools.find((tool) => tool.name === "wait");

    expect(swipe?.inputSchema.safeParse({ direction: "up" }).success).toBe(true);
    expect(swipe?.inputSchema.safeParse({ direction: "sideways" }).success).toBe(false);
    expect(wait?.inputSchema.safeParse({ ms: 0 }).success).toBe(false);
  });
});

describe("actionFromToolRequest", () => {
  test("puts the tool name back as the action's type", () => {
    expect(actionFromToolRequest({ name: "tap", input: { ref: 3 } })).toEqual({
      type: "tap",
      ref: 3,
    });
  });

  test("carries every argument through", () => {
    expect(
      actionFromToolRequest({ name: "finish", input: { verdict: "passed", reason: "done" } }),
    ).toEqual({ type: "finish", verdict: "passed", reason: "done" });
  });

  test("rejects a tool the schema has no variant for", () => {
    expect(() => actionFromToolRequest({ name: "teleport", input: { ref: 0 } })).toThrow();
  });

  test("rejects arguments the variant does not accept, so a bad ref is not acted on", () => {
    expect(() => actionFromToolRequest({ name: "tap", input: { ref: -1 } })).toThrow();
  });

  test("rejects a call that left a required argument out", () => {
    expect(() => actionFromToolRequest({ name: "input_text", input: { ref: 0 } })).toThrow();
  });

  test("treats a non-object input as no arguments at all, which the schema then refuses", () => {
    expect(() => actionFromToolRequest({ name: "tap", input: "ref=0" })).toThrow();
  });
});

describe("soleToolRequest", () => {
  const tap = { name: "tap", input: { ref: 0 } };

  test("returns the one call a turn is allowed to make", () => {
    expect(soleToolRequest([tap])).toBe(tap);
  });

  test("refuses an empty list, since prose is not a decision", () => {
    expect(() => soleToolRequest([])).toThrow(LlmDecisionError);
  });

  test("refuses several calls rather than picking one on the model's behalf", () => {
    expect(() => soleToolRequest([tap, { name: "wait", input: { ms: 500 } }])).toThrow(
      LlmDecisionError,
    );
  });
});

describe("GenkitLlm tool-call handling", () => {
  const input = { scenarioPrompt: "log in", historySummary: "", uiText: "[0] Button" };

  test("offers the action tools to the model", async () => {
    let seen: { tools?: { name: string }[] } = {};
    const llm = new GenkitLlm({
      generate: async (request) => {
        seen = request;
        return { toolRequests: [{ name: "tap", input: { ref: 0 } }] };
      },
    });

    await llm.decide(input);

    expect(seen.tools?.map((tool) => tool.name)).toContain("finish");
  });

  test("retries when the model calls several tools rather than choosing one", async () => {
    let calls = 0;
    const llm = new GenkitLlm({
      generate: async () => {
        calls++;
        const isIndecisive = calls === 1;
        return {
          toolRequests: isIndecisive
            ? [
                { name: "tap", input: { ref: 0 } },
                { name: "wait", input: { ms: 500 } },
              ]
            : [{ name: "tap", input: { ref: 0 } }],
        };
      },
    });

    expect(await llm.decide(input)).toEqual({ type: "tap", ref: 0 });
    expect(calls).toBe(2);
  });

  test("retries a call whose arguments the schema refuses", async () => {
    let calls = 0;
    const llm = new GenkitLlm({
      generate: async () => {
        calls++;
        const isBad = calls === 1;
        return {
          toolRequests: [isBad ? { name: "tap", input: {} } : { name: "tap", input: { ref: 2 } }],
        };
      },
    });

    expect(await llm.decide(input)).toEqual({ type: "tap", ref: 2 });
    expect(calls).toBe(2);
  });
});

describe("ActionSchema behind the tools", () => {
  test("accepts every action a tool call can rebuild", () => {
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
