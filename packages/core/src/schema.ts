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
  /*
   * The rest of what uiautomator reports, carried so the XML format can show
   * the model the dump rather than our reading of it. Optional because a web
   * page has no faithful equivalent for several of them, and a guessed value
   * would be worse than an absent one; the text format ignores them all, so
   * its output -- and the benchmarks recorded against it -- does not move.
   */
  package?: string | undefined;
  checkable?: boolean | undefined;
  focusable?: boolean | undefined;
  scrollable?: boolean | undefined;
  longClickable?: boolean | undefined;
  password?: boolean | undefined;
  selected?: boolean | undefined;
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
    package: z.string().optional(),
    checkable: z.boolean().optional(),
    focusable: z.boolean().optional(),
    scrollable: z.boolean().optional(),
    longClickable: z.boolean().optional(),
    password: z.boolean().optional(),
    selected: z.boolean().optional(),
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
 * How the screen is handed to the model: `text` is the compact, numbered
 * rendering the agent was built around; `xml` is every node of the parsed tree,
 * unpruned. The second exists to measure what the compaction costs or gains,
 * so both must stay selectable per case rather than being a build-time choice.
 */
export const UiFormatSchema = z.enum(["text", "xml"]);
export type UiFormat = z.infer<typeof UiFormatSchema>;

/** What a case runs with when nothing -- case, scenario, or env -- says otherwise. */
export const DEFAULT_UI_FORMAT: UiFormat = "text";

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

/**
 * What a unit of work can be once something is actually doing it.
 *
 * Named separately from {@link RunStatusSchema} because a case has no waiting
 * state to be in: cases are created by the runner, one at a time, at the moment
 * their turn comes -- there is no point at which a case document exists and is
 * not yet being worked on. Sharing one enum would let `queued` be written to a
 * case, and the reader would have no way to tell that from a case genuinely
 * stalled, since nothing would ever move it.
 */
export const CaseStatusSchema = z.enum(["running", "passed", "failed", "error"]);
export type CaseStatus = z.infer<typeof CaseStatusSchema>;

/**
 * Lifecycle order, so the list reads the way a run actually progresses.
 * `queued` is a run that has an id and a Firestore document but has not touched
 * the device yet: the queue writes it, the runner claims it and moves it to
 * `running`.
 *
 * Widening a zod enum is backwards compatible, so documents written before
 * `queued` existed still parse -- no migration of stored runs is needed.
 */
export const RunStatusSchema = z.enum(["queued", ...CaseStatusSchema.options]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

/**
 * The statuses that mean some process is still meant to be working on the run.
 *
 * Stated once, as data, because three places have to agree: the server's
 * startup sweep queries Firestore for exactly these, the CLI's poll treats
 * exactly these as "no answer yet", and {@link isUnsettledRun} answers the same
 * question for a run already in hand. Written out separately in each, they would
 * drift the next time a status is added -- silently, since the symptom is only
 * that one of them stops noticing a state the reader is still shown as pending.
 */
export const UNSETTLED_RUN_STATUSES = ["queued", "running"] as const satisfies readonly RunStatus[];

/**
 * Whether a run has yet to reach a verdict.
 *
 * True for a run still waiting its turn and for one on a device; false for
 * every run that finished, however it finished. `error` counts as settled: a
 * run that could not be completed HAS an answer, and treating it otherwise is
 * what makes a CLI poll wait forever for a verdict nobody is coming to give.
 *
 * Lives beside {@link RunStatusSchema} rather than in the store so the CLI can
 * share it: the store's entry point pulls in firebase-admin, which a
 * `bun build --compile` binary that only speaks HTTP must not carry.
 */
export function isUnsettledRun(status: RunStatus): boolean {
  return (UNSETTLED_RUN_STATUSES as readonly RunStatus[]).includes(status);
}

/**
 * Someone whose eyes a persona review looks through. Not limited to a
 * disability: a young child who cannot read kanji yet or someone unused to
 * apps is as valid a persona, and the description alone says what they would
 * struggle with.
 */
export const PersonaSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/)
    .max(80),
  label: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(2000),
});
export type Persona = z.infer<typeof PersonaSchema>;

export const PERSONA_PRESETS: readonly Persona[] = [
  {
    id: "red-green",
    label: "赤・緑の見分けにくさ",
    description:
      "赤と緑の違いを識別しにくい利用者。状態・操作・グラフの区別が色だけに依存せず、文字・形・模様でも伝わるか確認する。",
  },
  {
    id: "blue-yellow",
    label: "青・黄の見分けにくさ",
    description:
      "青と黄などの色の違いを識別しにくい利用者。情報の区別を色だけに依存させていないか確認する。",
  },
  {
    id: "presbyopia",
    label: "老眼・近くの文字の読みづらさ",
    description:
      "近くの小さな文字に焦点を合わせにくい利用者。小さい文字、細い線、情報の詰め込み、低いコントラストによる読みにくさを確認する。画像から実際の文字サイズや視距離を断定しない。",
  },
  {
    id: "low-vision",
    label: "弱視・細部の見えづらさ",
    description:
      "文字やアイコンの細部を認識しにくい利用者。文字・背景・操作部品の区別、視覚的な密集、重要情報の目立ちやすさを確認する。",
  },
  {
    id: "kanji-reading",
    label: "漢字が読みにくい（低学年の子ども）",
    description:
      "漢字をまだ多く読めない小学校低学年の子ども。ふりがなの無い漢字、難しい語彙や言い回し、文字だけで伝える説明で理解できない箇所がないか確認する。画像から年齢や読字能力を断定しない。",
  },
];

export const PersonaReviewSettingsSchema = z.object({
  // An explicit empty list disables an inherited review; omission inherits.
  personas: z
    .array(PersonaSchema)
    .max(8)
    .refine(
      (personas) => new Set(personas.map((persona) => persona.id)).size === personas.length,
      "persona ids must be unique",
    ),
});
export type PersonaReviewSettings = z.infer<typeof PersonaReviewSettingsSchema>;

export const PersonaFindingSchema = z.object({
  // Values are only ever added: steps already stored carry the first five, so
  // removing or renaming one would make those runs unreadable.
  category: z.enum([
    "color_only",
    "contrast",
    "text_size",
    "visual_clutter",
    "language",
    "comprehension",
    "other",
  ]),
  location: z.string().trim().min(1).max(1000),
  reason: z.string().trim().min(1).max(2000),
  suggestion: z.string().trim().min(1).max(2000),
});
export type PersonaFinding = z.infer<typeof PersonaFindingSchema>;

export const PersonaFindingsSchema = z.object({
  personaId: PersonaSchema.shape.id,
  findings: z.array(PersonaFindingSchema).max(20),
});
export type PersonaFindings = z.infer<typeof PersonaFindingsSchema>;

export const PersonaReviewReportSchema = z.object({
  reviews: z.array(PersonaFindingsSchema).min(1).max(8),
});
export type PersonaReviewReport = z.infer<typeof PersonaReviewReportSchema>;

export const PersonaReviewSchema = z.discriminatedUnion("status", [
  PersonaReviewReportSchema.extend({
    status: z.literal("completed"),
    personas: PersonaReviewSettingsSchema.shape.personas,
    screenshotPath: z.string().min(1),
    model: z.string().min(1),
  }),
  z.object({
    status: z.literal("error"),
    personas: PersonaReviewSettingsSchema.shape.personas,
    screenshotPath: z.string().min(1).nullable(),
    model: z.string().min(1),
    error: z.string().min(1),
  }),
]);
export type PersonaReview = z.infer<typeof PersonaReviewSchema>;

export const StepSchema = z.object({
  runId: z.string(),
  caseId: z.string(),
  index: z.number().int().nonnegative(),
  action: ActionSchema,
  uiText: z.string(),
  screenshotPath: z.string().nullable(),
  /**
   * Stored as `accessibilityReview` before the feature was renamed; the store
   * reads either spelling and writes only this one.
   */
  personaReview: PersonaReviewSchema.nullable().optional(),
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
  /**
   * The screen format actually used, resolved like `model`. Optional rather
   * than defaulted: a case stored before the switch existed ran on `text`, but
   * the record should say "not recorded" rather than claim a choice nobody made.
   */
  uiFormat: UiFormatSchema.optional(),
  status: CaseStatusSchema,
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
 * Rewrites the legacy `accessibility:` key into `personaReview:`, on a
 * scenario and on each case alike.
 *
 * The feature was first called visual accessibility review; it was renamed
 * when personas stopped being only disabilities (a child who cannot read kanji
 * yet has nothing to do with accessibility). Files written before that keep
 * loading, and -- as with {@link normalizeTarget} -- nothing downstream of the
 * parse ever sees the old spelling.
 *
 * Unlike `app:`/`target:`, giving both keys is an error rather than "the new
 * one wins": the two are the same list of personas, so a file carrying both
 * has one of them silently ignored, and there is no migration step that needs
 * both at once -- the dashboard rewrites the key in place.
 */
function normalizePersonaReviewKey(input: unknown, ctx: z.RefinementCtx): unknown {
  const isMapping = typeof input === "object" && input !== null && !Array.isArray(input);
  if (!isMapping) {
    return input;
  }

  const { accessibility, ...rest } = input as Record<string, unknown> & {
    accessibility?: unknown;
  };
  const hasLegacy = accessibility !== undefined;
  if (!hasLegacy) {
    return rest;
  }

  const hasBoth = rest["personaReview"] !== undefined;
  if (hasBoth) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["accessibility"],
      message: "give personas under `personaReview:` only; `accessibility:` is its legacy name",
    });
    // The rest still goes through the schema so other mistakes in the same
    // mapping are reported together with this one.
    return rest;
  }
  return { ...rest, personaReview: accessibility };
}

/**
 * One assertion about the app, in natural language. A case is what actually
 * gets a verdict; the scenario around it only groups and orders them.
 */
export const TestCaseSchema = z.preprocess(
  normalizePersonaReviewKey,
  z.object({
    /** Slug: it addresses a Firestore document and appears in URLs and logs. */
    id: z
      .string()
      .min(1)
      .regex(/^[a-z0-9][a-z0-9-]*$/, "must be a lowercase slug (a-z, 0-9, hyphen)"),
    title: z.string().min(1).optional(),
    prompt: z.string().min(1),
    /** Overrides the scenario's model for this case alone. */
    model: z.string().min(1).optional(),
    /** Overrides the scenario's screen format for this case alone. */
    uiFormat: UiFormatSchema.optional(),
    /** Overrides the scenario's target, so one file may mix platforms. */
    target: TargetSchema.optional(),
    /** Overrides the scenario's personas; an empty list turns the review off. */
    personaReview: PersonaReviewSettingsSchema.optional(),
    // A wrong turn early can otherwise burn tokens indefinitely; every case is
    // bounded even when the scenario file omits a budget.
    maxSteps: z.number().int().positive().default(20),
  }),
);

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
  (input, ctx) => normalizePersonaReviewKey(normalizeTarget(input), ctx),
  z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    /**
     * Labels for picking what to run.
     *
     * Not on {@link TestCaseSchema}: the unit of execution is the scenario, so
     * a case-level tag would have to mean "run this scenario but only some of
     * its cases" -- a run whose verdict you could not attribute, because the
     * cases that did not run are indistinguishable from the ones that passed.
     *
     * Defaulted rather than optional so no consumer has to write `?? []`, and
     * so scenario files that predate tags keep parsing unchanged.
     */
    tags: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "must be a lowercase slug")).default([]),
    /** Default target for every case that does not name its own. */
    target: TargetSchema.optional(),
    /** Default model for every case that does not name its own. */
    model: z.string().min(1).optional(),
    /** Default screen format for every case that does not name its own. */
    uiFormat: UiFormatSchema.optional(),
    /** Default personas for every case that does not name its own. */
    personaReview: PersonaReviewSettingsSchema.optional(),
    cases: z.array(TestCaseSchema).min(1, "a scenario needs at least one case"),
  }),
);

export type Scenario = z.infer<typeof ScenarioSchema>;
/** Pre-parse shape: `maxSteps` is optional on disk, defaulted after parsing. */
export type ScenarioInput = z.input<typeof ScenarioSchema>;

export function resolvePersonaReview(
  testCase: Pick<TestCase, "personaReview">,
  scenario: Pick<Scenario, "personaReview">,
): PersonaReviewSettings | undefined {
  return testCase.personaReview ?? scenario.personaReview;
}

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
 * Picks the screen format for a case on the same chain as {@link resolveModel},
 * so an A/B of the two formats can be one scenario with a per-case override.
 */
export function resolveUiFormat(
  testCase: Pick<TestCase, "uiFormat">,
  scenario: Pick<Scenario, "uiFormat">,
  fallback: UiFormat,
): UiFormat {
  return testCase.uiFormat ?? scenario.uiFormat ?? fallback;
}

/**
 * Reads a process-wide default such as `UI_FORMAT`. Anything unrecognised
 * falls back to {@link DEFAULT_UI_FORMAT} rather than failing startup: the
 * dashboard has to boot to show what is wrong, and `text` is what every run
 * before this switch used.
 */
export function parseUiFormat(raw: string | undefined): UiFormat {
  const parsed = UiFormatSchema.safeParse(raw?.trim().toLowerCase());
  return parsed.success ? parsed.data : DEFAULT_UI_FORMAT;
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

/**
 * Keeps the scenarios carrying every selected tag. An empty selection is "no
 * filter", not "nothing matches" -- the unfiltered list is what the dashboard
 * shows before anyone touches a chip.
 *
 * AND rather than OR: with OR, every tag you add widens the result, so the
 * chips would only ever grow the list and the most common question --
 * "smoke and android" -- would be inexpressible. Narrowing is the operation
 * a filter is for.
 *
 * Lives beside {@link describeTarget} so the CLI and the dashboard cannot
 * drift into two different filter rules.
 */
export function filterByTags(scenarios: Scenario[], selected: string[]): Scenario[] {
  const hasNoSelection = selected.length === 0;
  if (hasNoSelection) {
    return scenarios;
  }

  return scenarios.filter((scenario) => {
    const tags = new Set(scenario.tags);
    return selected.every((tag) => tags.has(tag));
  });
}

/**
 * Every tag in use, deduped.
 *
 * Sorted lexicographically rather than kept in order of first appearance: the
 * chip row is a stable piece of UI, and appearance order would reshuffle it
 * whenever a scenario is added, renamed, or removed from the directory.
 */
export function collectTags(scenarios: Scenario[]): string[] {
  const tags = new Set<string>();
  for (const scenario of scenarios) {
    for (const tag of scenario.tags) {
      tags.add(tag);
    }
  }

  return [...tags].sort();
}
