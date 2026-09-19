import { type Genkit, genkit, z } from "genkit";
import { openAICompatible } from "@genkit-ai/compat-oai";
import { type Action, ActionSchema } from "@gemma-e2e/core";
import { errorFields, type Logger, noopLogger } from "@gemma-e2e/logger";

export interface DecideInput {
  scenarioPrompt: string;
  historySummary: string;
  uiText: string;
  /**
   * Facts the agent chose to keep, newest last. Passed separately from the
   * history so they survive the history window: a code read on step 2 is still
   * in the prompt on step 40.
   */
  rememberedFacts?: readonly string[] | undefined;
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

export const SYSTEM_PROMPT = `You are an E2E test operator. The screen may be a
phone app or a web page; you drive both the same way.

You are given a test goal, a summary of what you have already done, and a text
rendering of the current screen's UI tree. Choose exactly ONE next action.

Interactive elements are numbered like [0], [1]. Use those numbers as "ref".
Never invent a ref that is not on the screen.

Actions:
- tap: press the element with the given ref.
- input_text: type text into the element with the given ref. Tap a field before
  typing into it if it is not already focused.
- swipe: scroll the screen (up scrolls toward later content).
- key_event: back returns to the previous screen, home goes to the start, and
  enter submits the focused field.
- wait: pause when the screen looks like it is still loading.
- remember: record a fact from the current screen that a later step will need
  (a confirmation code, an order number, a total). It touches nothing on the
  device, so use it only for values you would otherwise lose once you navigate
  away — never for narrating what you just did. If such a value is on the screen
  now, remember it BEFORE the action that leaves that screen: once you have left,
  the value is gone and you cannot go back for it.
- finish: end the test. Use verdict "passed" once you can SEE the goal has been
  met, and "failed" when the goal cannot be achieved (a blocking error, a dead
  end, or the same screen repeating with no progress). Always give a reason.

Prefer finishing over repeating an action that changed nothing.

Answer by calling exactly one tool. Do not describe what you would do, and do
not call several tools at once: one turn is one action, and the screen you see
next is the result of it.`;

/**
 * One action variant, described the way a tool-calling model takes it.
 *
 * Derived from {@link ActionSchema} rather than written out again: the union is
 * the source of truth for what the agent can do, and a hand-kept second list
 * would drift the first time an action is added -- silently, because the
 * symptom is only that the model is never offered the new move.
 */
export interface ActionTool {
  name: Action["type"];
  description: string;
  /** The variant's own object schema, minus the `type` the tool name carries. */
  inputSchema: z.ZodTypeAny;
}

/**
 * What each action is for, in the words the model is given.
 *
 * Kept beside the schema-derived shapes rather than inside {@link SYSTEM_PROMPT}
 * because a tool-calling model reads a tool's description at the point of
 * choosing it, where a paragraph further up the prompt competes with everything
 * else for attention.
 */
const ACTION_DESCRIPTIONS: Record<Action["type"], string> = {
  tap: "Press the element with the given ref.",
  input_text:
    "Type text into the element with the given ref. Tap a field before typing into it if it is not already focused.",
  swipe: "Scroll the screen; up scrolls toward later content.",
  key_event:
    "Press a hardware key: back returns to the previous screen, home goes to the start, enter submits the focused field.",
  wait: "Pause when the screen looks like it is still loading.",
  remember:
    "Record a value from THIS screen that a later step will need (a code, an order number, a total). It touches nothing on the device. Use it before the action that leaves the screen showing the value, never to narrate what you just did.",
  finish:
    'End the test. Use verdict "passed" once you can SEE the goal has been met, and "failed" when it cannot be achieved. Always give a reason.',
};

/**
 * The action union, restated as one tool per variant.
 *
 * `type` is dropped from each input schema because the tool NAME already
 * carries it: leaving it in asks the model to state the same choice twice, and
 * a model that fills it in inconsistently with the tool it called would give us
 * two answers and no way to pick.
 */
export function actionTools(): ActionTool[] {
  return ActionSchema.options.map((variant) => {
    const shape = variant.shape as Record<string, z.ZodTypeAny>;
    const { type: _type, ...rest } = shape;
    const name = variant.shape.type.value as Action["type"];

    return {
      name,
      description: ACTION_DESCRIPTIONS[name],
      inputSchema: z.object(rest),
    };
  });
}

/** One tool call, as the model asked for it. */
export interface ToolRequest {
  name: string;
  input: unknown;
}

export interface GenerateRequest {
  model: string;
  system: string;
  prompt: string;
  tools: ActionTool[];
}

/** Injection seam: tests supply a stub so retries need no model server. */
export type GenerateFn = (request: GenerateRequest) => Promise<{ toolRequests: ToolRequest[] }>;

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

  // Its own section rather than lines prepended to the history: the history is
  // a sliding window, and a fact folded into it would age out of the prompt
  // exactly when a long run needs it most.
  const facts = input.rememberedFacts ?? [];
  const hasFacts = facts.length > 0;
  const factsSection = hasFacts
    ? [`# Remembered facts`, ...facts.map((fact) => `- ${fact}`), ``]
    : [];

  return [
    `# Goal`,
    input.scenarioPrompt,
    ``,
    ...factsSection,
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
 * Rebuilds the action a tool call stands for.
 *
 * The tool name is the discriminant and the arguments are the rest, so this
 * puts `type` back and hands the result to {@link ActionSchema} -- the same
 * validation the structured-output path used. The model choosing a tool does
 * not make its ARGUMENTS right: a `tap` with no `ref`, or a `finish` with an
 * invented verdict, still has to fail here and be retried.
 *
 * Why the whole request rather than just the input: a name that matches no
 * variant is the one failure a schema on the input alone cannot catch, and it
 * is the failure a model inventing a tool produces.
 */
export function actionFromToolRequest(request: ToolRequest): Action {
  const input = request.input;
  const isObject = typeof input === "object" && input !== null && !Array.isArray(input);
  const fields = isObject ? (input as Record<string, unknown>) : {};

  return ActionSchema.parse({ type: request.name, ...fields });
}

/**
 * Picks the one call an action is, out of what the model actually sent.
 *
 * A turn is one move, so anything but a single call is a decision we do not
 * have: none means the model answered in prose despite being told to call a
 * tool, and several means it listed options rather than choosing. Both are
 * retried rather than resolved here -- taking the first of several would be us
 * choosing the test's next move on the model's behalf, which is exactly what
 * the envelope-unwrapping in the structured-output path refused to do.
 */
export function soleToolRequest(requests: readonly ToolRequest[]): ToolRequest {
  const hasOne = requests.length === 1;
  if (!hasOne) {
    throw new LlmDecisionError(
      `model made ${requests.length} tool calls where exactly one action was asked for`,
    );
  }

  return requests[0] as ToolRequest;
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

  // Registered once, not per request: `defineTool` names a tool on the Genkit
  // instance, and redefining the same name on every decision would grow the
  // registry for the length of a run.
  //
  // The implementations are deliberately inert. Genkit's tool loop exists to
  // run a tool and feed its result back for another turn, but an action here is
  // performed by the driver against a real device, and its "result" is the next
  // screen -- which reaches the model as the next decision's prompt, not as a
  // tool response. `returnToolRequests` below stops that loop so the request
  // itself is the answer.
  const tools = actionTools().map((tool) =>
    ai.defineTool(
      { name: tool.name, description: tool.description, inputSchema: tool.inputSchema },
      async () => undefined,
    ),
  );

  return async (request) => {
    const response = await ai.generate({
      model: request.model,
      system: request.system,
      prompt: request.prompt,
      tools,
      // The model is asked for an action, so prose is never an acceptable
      // answer; `required` turns "it replied with a paragraph" into a retry
      // rather than into a decision nobody can act on.
      toolChoice: "required",
      returnToolRequests: true,
    });

    return {
      toolRequests: response.toolRequests.map((part) => ({
        // `part.toolRequest.ref` is Genkit's call id, NOT our element ref; the
        // element ref travels inside `input` like any other argument.
        name: part.toolRequest.name,
        input: part.toolRequest.input,
      })),
    };
  };
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
 * Native tool calls rather than a structured response schema. The earlier
 * choice went the other way because the tool-call parsers in MLX-family Gemma
 * builds were unreliable; measured again on 2026-09-20 against LM Studio 0.4.24
 * with `google/gemma-4-26b-a4b-qat`, 15 of 15 calls came back with a
 * well-formed `tool_calls` and valid argument JSON, including enum-constrained
 * and multi-field variants. See `knowledge/` for the measurement.
 *
 * What this buys: the action variants reach the model as seven separate tools
 * with their own descriptions, so choosing one is a choice between named moves
 * rather than a shape to imitate. It also retires the `anyOf`/`oneOf`
 * unwrapping the schema path needed, since a model that echoed the schema back
 * was answering with the response's SHAPE -- a failure mode a tool call has no
 * way to express.
 *
 * What it does not change: the arguments are still parsed by
 * {@link ActionSchema} here and retried on our terms, because a model that
 * picks the right tool can still name a ref that is not on the screen.
 */
export class GenkitLlm implements Llm {
  readonly #model: string;
  readonly #maxAttempts: number;
  readonly #tools: ActionTool[] = actionTools();
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
          tools: this.#tools,
        });

        // Validated here rather than trusted because it arrived as a tool call:
        // the model picking a tool says nothing about the arguments it filled
        // in, and a retry often succeeds where the first answer named a ref
        // that is not on the screen.
        const action = actionFromToolRequest(soleToolRequest(response.toolRequests));

        this.#log.info("llm.decided", {
          attempt,
          model: this.#model,
          durationMs: Math.round(this.#now() - startedAt),
          type: action.type,
        });

        return action;
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
