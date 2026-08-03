import { z } from "zod";

/** Screen-space rectangle, as uiautomator reports it: `[x1,y1][x2,y2]`. */
export const BoundsSchema = z.object({
  x1: z.number().int(),
  y1: z.number().int(),
  x2: z.number().int(),
  y2: z.number().int(),
});

export type Bounds = z.infer<typeof BoundsSchema>;

export interface UiNode {
  text: string;
  resourceId: string;
  className: string;
  contentDesc: string;
  bounds: Bounds;
  clickable: boolean;
  enabled: boolean;
  focused: boolean;
  checked?: boolean | undefined;
  children: UiNode[];
}

/**
 * Recursive schemas need the type stated up front; z.lazy alone infers `any`.
 * Declared as a typed ZodType so `children` keeps its element type.
 */
export const UiNodeSchema: z.ZodType<UiNode> = z.lazy(() =>
  z.object({
    text: z.string(),
    resourceId: z.string(),
    className: z.string(),
    contentDesc: z.string(),
    bounds: BoundsSchema,
    clickable: z.boolean(),
    enabled: z.boolean(),
    focused: z.boolean(),
    checked: z.boolean().optional(),
    children: z.array(UiNodeSchema),
  }),
);

export const SwipeDirectionSchema = z.enum(["up", "down", "left", "right"]);
export type SwipeDirection = z.infer<typeof SwipeDirectionSchema>;

export const KeyNameSchema = z.enum(["back", "home", "enter"]);
export type KeyName = z.infer<typeof KeyNameSchema>;

export const VerdictSchema = z.enum(["passed", "failed"]);
export type Verdict = z.infer<typeof VerdictSchema>;

/**
 * The model's move. `ref` is the bracketed index the UI serializer assigned to
 * an interactive element, not a device coordinate -- the executor resolves it.
 * Kept as a flat discriminated union so structured output stays easy for the
 * model to emit and cheap to validate.
 */
export const ActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("tap"),
    ref: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("input_text"),
    ref: z.number().int().nonnegative(),
    text: z.string(),
  }),
  z.object({
    type: z.literal("swipe"),
    direction: SwipeDirectionSchema,
  }),
  z.object({
    type: z.literal("key_event"),
    key: KeyNameSchema,
  }),
  z.object({
    type: z.literal("wait"),
    ms: z.number().int().positive(),
  }),
  // Carries a fact forward instead of a device instruction: the agent is
  // stateless apart from its history window, so a value only visible on one
  // screen (a code, a total) is gone by the time a later step needs it.
  z.object({
    type: z.literal("remember"),
    text: z.string().min(1),
  }),
  z.object({
    type: z.literal("finish"),
    verdict: VerdictSchema,
    reason: z.string(),
  }),
]);

export type Action = z.infer<typeof ActionSchema>;

export const RunStatusSchema = z.enum(["running", "passed", "failed", "error"]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const StepSchema = z.object({
  runId: z.string(),
  caseId: z.string(),
  index: z.number().int().nonnegative(),
  action: ActionSchema,
  uiText: z.string(),
  screenshotPath: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
});

export type Step = z.infer<typeof StepSchema>;

/** One case's slice of a run: its own verdict, model, and step timeline. */
export const CaseRunSchema = z.object({
  runId: z.string(),
  caseId: z.string(),
  /** Position within the scenario, so cases sort in declaration order. */
  order: z.number().int().nonnegative(),
  title: z.string(),
  prompt: z.string(),
  /** The model actually used, after `case.model ?? scenario.model ?? env`. */
  model: z.string(),
  status: RunStatusSchema,
  verdictReason: z.string().nullable(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  /**
   * Screen recording of this case, or null when recording was off or failed.
   * Defaulted so case documents written before recording existed still parse.
   */
  videoPath: z.string().nullable().default(null),
  steps: z.array(StepSchema).default([]),
});

export type CaseRun = z.infer<typeof CaseRunSchema>;

export const RunSchema = z.object({
  id: z.string(),
  scenarioId: z.string(),
  title: z.string(),
  status: RunStatusSchema,
  verdictReason: z.string().nullable(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  cases: z.array(CaseRunSchema).default([]),
});

export type Run = z.infer<typeof RunSchema>;

/**
 * What a case drives: an installed Android app, or a page in a browser.
 *
 * A discriminated union rather than one object with optional fields, so a
 * target that names a package can never also name a URL, and so the driver
 * resolver's switch is exhaustive -- adding a platform then fails to compile
 * until every site handles it.
 */
export const AndroidTargetSchema = z.object({
  platform: z.literal("android"),
  package: z.string().min(1),
  activity: z.string().min(1).optional(),
});

export type AndroidTarget = z.infer<typeof AndroidTargetSchema>;

export const WebTargetSchema = z.object({
  platform: z.literal("web"),
  url: z.string().url(),
  /** Omitted, the driver's default viewport applies. */
  viewport: z
    .object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    })
    .optional(),
});

export type WebTarget = z.infer<typeof WebTargetSchema>;

export const TargetSchema = z.discriminatedUnion("platform", [
  AndroidTargetSchema,
  WebTargetSchema,
]);

export type Target = z.infer<typeof TargetSchema>;

/** The discriminant on its own, for code that selects a platform before a target exists. */
export type Platform = Target["platform"];

/**
 * The pre-`target` spelling, kept so scenario files written before browsers
 * existed keep loading. Normalised to an android target on parse, so nothing
 * downstream of the schema ever sees this shape.
 */
const LegacyAppTargetSchema = z.object({
  package: z.string().min(1),
  activity: z.string().min(1).optional(),
});

/**
 * One assertion about the app, in natural language. A case is what actually
 * gets a verdict; the scenario around it only groups and orders them.
 */
export const TestCaseSchema = z.object({
  /** Slug: it addresses a Firestore document and appears in URLs and logs. */
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9-]*$/, "must be a lowercase slug (a-z, 0-9, hyphen)"),
  title: z.string().min(1).optional(),
  prompt: z.string().min(1),
  /** Overrides the scenario's model for this case alone. */
  model: z.string().min(1).optional(),
  /** Overrides the scenario's target, so one file may mix platforms. */
  target: TargetSchema.optional(),
  // A wrong turn early can otherwise burn tokens indefinitely; every case is
  // bounded even when the scenario file omits a budget.
  maxSteps: z.number().int().positive().default(20),
});

export type TestCase = z.infer<typeof TestCaseSchema>;

/**
 * Rewrites the legacy `app:` key into an android `target:`.
 *
 * Done as a preprocess rather than by keeping both keys on the schema: two
 * spellings of the same thing would then reach every consumer, and each would
 * have to decide which wins. Here the ambiguity is resolved once, and
 * everything downstream of the parse sees only `target`.
 *
 * An explicit `target:` wins, so a file being migrated can carry both while
 * the old key is removed.
 */
function normalizeTarget(input: unknown): unknown {
  const isMapping = typeof input === "object" && input !== null && !Array.isArray(input);
  if (!isMapping) {
    return input;
  }

  const { app, ...rest } = input as Record<string, unknown> & { app?: unknown };

  const hasTarget = rest["target"] !== undefined;
  if (hasTarget) {
    return rest;
  }

  const hasApp = app !== undefined;
  if (!hasApp) {
    return rest;
  }

  // A malformed `app:` is forwarded as the target rather than dropped: the
  // object schema ignores keys it does not know, so discarding it here would
  // load the scenario as though it had named no target at all -- and the case
  // would then drive whatever the previous one left on screen.
  const legacy = LegacyAppTargetSchema.safeParse(app);
  return legacy.success
    ? { ...rest, target: { platform: "android", ...legacy.data } }
    : { ...rest, target: app };
}

export const ScenarioSchema = z.preprocess(
  normalizeTarget,
  z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    /** Default target for every case that does not name its own. */
    target: TargetSchema.optional(),
    /** Default model for every case that does not name its own. */
    model: z.string().min(1).optional(),
    cases: z.array(TestCaseSchema).min(1, "a scenario needs at least one case"),
  }),
);

export type Scenario = z.infer<typeof ScenarioSchema>;
/** Pre-parse shape: `maxSteps` is optional on disk, defaulted after parsing. */
export type ScenarioInput = z.input<typeof ScenarioSchema>;

/**
 * Picks the model for a case: the case's own choice wins, then the scenario's,
 * then the process default. Kept here rather than in the agent so the server
 * and dashboard can show the same answer without running anything.
 */
export function resolveModel(
  testCase: Pick<TestCase, "model">,
  scenario: Pick<Scenario, "model">,
  fallback: string,
): string {
  return testCase.model ?? scenario.model ?? fallback;
}

/**
 * Picks the target for a case, on the same case-then-scenario chain as
 * {@link resolveModel}. There is no process-wide fallback: a case with no
 * target anywhere drives whatever is already on screen, which is what a
 * scenario that omits `target:` has always meant.
 */
export function resolveTarget(
  testCase: Pick<TestCase, "target">,
  scenario: Pick<Scenario, "target">,
): Target | undefined {
  return testCase.target ?? scenario.target;
}

/**
 * One-line label for a target, e.g. `com.example/.MainActivity` or
 * `http://localhost:5174`. Lives here so the CLI and the dashboard cannot
 * drift into describing the same target two different ways.
 */
export function describeTarget(target: Target): string {
  switch (target.platform) {
    case "android": {
      const suffix = target.activity === undefined ? "" : `/${target.activity}`;
      return `${target.package}${suffix}`;
    }
    case "web":
      return target.url;
  }
}
