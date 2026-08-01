import { describe, expect, test } from "bun:test";
import { ActionSchema } from "@gemma-e2e/core";
import {
  buildDecisionPrompt,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  GenkitLlm,
  LlmDecisionError,
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
});

describe("SYSTEM_PROMPT", () => {
  test("names every action the schema accepts", () => {
    for (const action of ["tap", "input_text", "swipe", "key_event", "wait", "finish"]) {
      expect(SYSTEM_PROMPT).toContain(action);
    }
  });

  test("explains both verdicts", () => {
    expect(SYSTEM_PROMPT).toContain("passed");
    expect(SYSTEM_PROMPT).toContain("failed");
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
