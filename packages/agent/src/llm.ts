import { type Genkit, genkit } from "genkit";
import { openAICompatible } from "@genkit-ai/compat-oai";
import { type Action, ActionSchema } from "@gemma-e2e/core";
import { errorFields, type Logger, noopLogger } from "@gemma-e2e/logger";

export interface DecideInput {
  scenarioPrompt: string;
  historySummary: string;
  uiText: string;
}

/** The one thing the agent loop needs from a model: the next move. */
export interface Llm {
  decide(input: DecideInput): Promise<Action>;
}

/** Wall-clock milliseconds, so a slow model is visible without a profiler. */
export type Clock = () => number;

/**
 * Builds a client for one specific model. The loop takes a factory rather than
 * a client because the model is chosen per case, and a client fixed at
 * construction time could not vary within a single run.
 */
export type LlmFactory = (model: string) => Llm;

export const DEFAULT_BASE_URL = "http://localhost:1234/v1";
/** Only a last resort: `.env` (LLM_MODEL) is where a machine states its model. */
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
with the structured action.

Return the chosen action object itself, such as {"type":"tap","ref":0}. Do not
echo the schema back: no "anyOf", no "oneOf", no list of alternatives.`;

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
  /** Defaults to a no-op, so constructing a client never writes on its own. */
  logger?: Logger | undefined;
  /** Injection seam: a test can make a decision take an exact number of ms. */
  clock?: Clock | undefined;
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

/** The schema keywords a model echoes back when it confuses schema with value. */
const ENVELOPE_KEYS = ["anyOf", "oneOf"] as const;

/**
 * Unwraps a one-element `anyOf`/`oneOf` envelope around the action.
 *
 * Smaller models (E4B, measurably) sometimes answer with the *shape* of the
 * response schema rather than a value of it, emitting
 * `{"anyOf":[{"type":"input_text","ref":1,"text":"…"}]}`. The action inside is
 * correct, so retrying three times and erroring the case throws away a usable
 * decision over a wrapper.
 *
 * Why not unwrap more aggressively: an envelope holding several branches is the
 * model listing its options rather than choosing one, and picking a branch on
 * its behalf would be us deciding the test's next move. Anything but a single
 * wrapped object falls through unchanged and fails validation as before, so a
 * retry — where the model may actually choose — still happens.
 */
export function normalizeOutput(output: unknown): unknown {
  const isObject = typeof output === "object" && output !== null && !Array.isArray(output);
  if (!isObject) {
    return output;
  }

  const record = output as Record<string, unknown>;
  // Only a bare envelope is unwrapped: extra keys alongside it mean the shape is
  // something other than the wrapper this works around.
  const hasOnlyEnvelopeKey = Object.keys(record).length === 1;
  if (!hasOnlyEnvelopeKey) {
    return output;
  }

  for (const key of ENVELOPE_KEYS) {
    const branches = record[key];
    const isSingleBranch = Array.isArray(branches) && branches.length === 1;
    if (isSingleBranch) {
      return branches[0];
    }
  }

  return output;
}

/**
 * Opens one Genkit instance against the configured endpoint. The model is *not*
 * baked in here — it travels on each request — so a single instance serves
 * every model a run touches instead of one per case.
 */
function genkitGenerate(options: GenkitLlmOptions): GenerateFn {
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

/**
 * Builds the {@link LlmFactory} the agent loop takes, sharing one Genkit
 * instance (and therefore one HTTP client) across every model in a run.
 *
 * Why a factory instead of a mutable `setModel`: a case's model must be fixed
 * for the whole case, and a shared client whose model can be reassigned would
 * silently misroute a decision if runs ever overlap.
 */
export function createGenkitLlmFactory(options: GenkitLlmOptions = {}): LlmFactory {
  const generate = options.generate ?? genkitGenerate(options);
  return (model) => new GenkitLlm({ ...options, model, generate });
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
  readonly #log: Logger;
  readonly #now: Clock;

  constructor(options: GenkitLlmOptions = {}) {
    this.#model = options.model ?? process.env["LLM_MODEL"] ?? DEFAULT_MODEL;
    this.#maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
    this.#generate = options.generate ?? genkitGenerate(options);
    this.#log = options.logger ?? noopLogger;
    this.#now = options.clock ?? (() => performance.now());
  }

  async decide(input: DecideInput): Promise<Action> {
    const prompt = buildDecisionPrompt(input);
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.#maxAttempts; attempt++) {
      // Timed per attempt rather than per decide(): a decision that took a
      // minute because two attempts were thrown away is a different problem
      // from one slow generation, and only per-attempt numbers tell them apart.
      const startedAt = this.#now();

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
        const parsed = ActionSchema.safeParse(normalizeOutput(response.output));
        if (!parsed.success) {
          throw new LlmDecisionError(
            `model returned no schema-valid action: ${parsed.error.issues
              .map((issue) => issue.message)
              .join("; ")}`,
          );
        }

        this.#log.info("llm.decided", {
          attempt,
          model: this.#model,
          durationMs: Math.round(this.#now() - startedAt),
          type: parsed.data.type,
        });

        return parsed.data;
      } catch (error) {
        lastError = error;
        // Each retry is logged, not just the final failure: a run that succeeds
        // on attempt 3 every time is a model problem worth seeing before it
        // starts failing outright.
        this.#log.warn("llm.attempt_failed", {
          attempt,
          maxAttempts: this.#maxAttempts,
          model: this.#model,
          durationMs: Math.round(this.#now() - startedAt),
          ...errorFields(error),
        });
      }
    }

    const detail = lastError instanceof Error ? lastError.message : String(lastError);
    throw new LlmDecisionError(
      `model failed to produce a valid action after ${this.#maxAttempts} attempts: ${detail}`,
      { cause: lastError },
    );
  }
}
