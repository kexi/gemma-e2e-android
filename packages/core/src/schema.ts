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
  id: z.number().int().nonnegative(),
  runId: z.string(),
  index: z.number().int().nonnegative(),
  action: ActionSchema,
  uiText: z.string(),
  screenshotPath: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
});

export type Step = z.infer<typeof StepSchema>;

export const RunSchema = z.object({
  id: z.string(),
  scenarioId: z.string(),
  title: z.string(),
  prompt: z.string(),
  status: RunStatusSchema,
  verdictReason: z.string().nullable(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  steps: z.array(StepSchema).default([]),
});

export type Run = z.infer<typeof RunSchema>;

export const ScenarioSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  prompt: z.string().min(1),
  app: z
    .object({
      package: z.string().min(1),
      activity: z.string().min(1).optional(),
    })
    .optional(),
  // A wrong turn early can otherwise burn tokens indefinitely; every run is
  // bounded even when the scenario file omits a budget.
  maxSteps: z.number().int().positive().default(20),
});

export type Scenario = z.infer<typeof ScenarioSchema>;
/** Pre-parse shape: `maxSteps` is optional on disk, defaulted after parsing. */
export type ScenarioInput = z.input<typeof ScenarioSchema>;
