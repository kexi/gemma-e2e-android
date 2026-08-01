import { type Genkit, genkit } from "genkit";
import { openAICompatible } from "@genkit-ai/compat-oai";
import { type Action, ActionSchema } from "@gemma-e2e/core";

export interface DecideInput {
  scenarioPrompt: string;
  historySummary: string;
  uiText: string;
}

/** The one thing the agent loop needs from a model: the next move. */
export interface Llm {
  decide(input: DecideInput): Promise<Action>;
}

export const DEFAULT_BASE_URL = "http://localhost:1234/v1";
export const DEFAULT_MODEL = "gemma-4-12b";
const PLUGIN_NAME = "lmstudio";
const MAX_ATTEMPTS = 3;

export const SYSTEM_PROMPT = `You are an Android E2E test operator.

You are given a test goal, a summary of what you have already done, and a text
rendering of the current screen's UI tree. Choose exactly ONE next action.

Interactive elements are numbered like [0], [1]. Use those numbers as "ref".
Never invent a ref that is not on the screen.

Actions:
- tap: press the element with the given ref.
- input_text: type text into the element with the given ref. Tap a field before
  typing into it if it is not already focused.
- swipe: scroll the screen (up scrolls toward later content).
- key_event: press back, home, or enter.
- wait: pause when the screen looks like it is still loading.
- finish: end the test. Use verdict "passed" once you can SEE the goal has been
  met, and "failed" when the goal cannot be achieved (a blocking error, a dead
  end, or the same screen repeating with no progress). Always give a reason.

Prefer finishing over repeating an action that changed nothing. Respond only
with the structured action.`;

export interface GenerateRequest {
  model: string;
  system: string;
  prompt: string;
  output: { schema: typeof ActionSchema };
}

/** Injection seam: tests supply a stub so retries need no model server. */
export type GenerateFn = (request: GenerateRequest) => Promise<{ output: unknown }>;

export interface GenkitLlmOptions {
  baseURL?: string | undefined;
  model?: string | undefined;
  apiKey?: string | undefined;
  maxAttempts?: number | undefined;
  generate?: GenerateFn | undefined;
}

export class LlmDecisionError extends Error {
  override readonly name = "LlmDecisionError";
}

export function buildDecisionPrompt(input: DecideInput): string {
  const history =
    input.historySummary.trim() === ""
      ? "(nothing yet - this is the first step)"
      : input.historySummary;

  return [
    `# Goal`,
    input.scenarioPrompt,
    ``,
    `# Steps so far`,
    history,
    ``,
    `# Current screen`,
    input.uiText.trim() === "" ? "(the screen appears to be empty)" : input.uiText,
    ``,
    `Choose the next action.`,
  ].join("\n");
}

/**
 * Genkit-backed model client.
 *
 * Structured output rather than native tool calls: the tool-call parsers in
 * MLX-family Gemma builds are unreliable, while a Zod-constrained response
 * schema is validated locally and retried on our terms.
 */
export class GenkitLlm implements Llm {
  readonly #model: string;
  readonly #maxAttempts: number;
  readonly #generate: GenerateFn;

  constructor(options: GenkitLlmOptions = {}) {
    this.#model = options.model ?? process.env["LLM_MODEL"] ?? DEFAULT_MODEL;
    this.#maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
    this.#generate = options.generate ?? GenkitLlm.#genkitGenerate(options);
  }

  static #genkitGenerate(options: GenkitLlmOptions): GenerateFn {
    const baseURL = options.baseURL ?? process.env["LLM_BASE_URL"] ?? DEFAULT_BASE_URL;

    const ai = genkit({
      plugins: [
        openAICompatible({
          name: PLUGIN_NAME,
          baseURL,
          // LM Studio ignores the key but the OpenAI client requires one.
          apiKey: options.apiKey ?? process.env["LLM_API_KEY"] ?? "lm-studio",
        }),
      ],
    }) as Genkit;

    return async (request) => await ai.generate(request);
  }

  async decide(input: DecideInput): Promise<Action> {
    const prompt = buildDecisionPrompt(input);
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.#maxAttempts; attempt++) {
      try {
        const response = await this.#generate({
          model: `${PLUGIN_NAME}/${this.#model}`,
          system: SYSTEM_PROMPT,
          prompt,
          output: { schema: ActionSchema },
        });

        // Genkit returns null when the model's JSON fails the schema. Parsing
        // again here rather than trusting `output` keeps validation ours: a
        // retry often succeeds because the failure is formatting, not
        // capability.
        const parsed = ActionSchema.safeParse(response.output);
        if (!parsed.success) {
          throw new LlmDecisionError(
            `model returned no schema-valid action: ${parsed.error.issues
              .map((issue) => issue.message)
              .join("; ")}`,
          );
        }

        return parsed.data;
      } catch (error) {
        lastError = error;
      }
    }

    const detail = lastError instanceof Error ? lastError.message : String(lastError);
    throw new LlmDecisionError(
      `model failed to produce a valid action after ${this.#maxAttempts} attempts: ${detail}`,
      { cause: lastError },
    );
  }
}
