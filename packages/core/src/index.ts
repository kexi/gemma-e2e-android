// Everything here is also reachable as `@gemma-e2e/core/schema`, minus the
// loader below. That subpath exists because this entry pulls in node:fs and
// Bun.file through ./scenario.ts, which a browser build cannot typecheck
// against even when it imports nothing but types.
export {
  ACCESSIBILITY_PERSONA_PRESETS,
  AccessibilityFindingSchema,
  AccessibilityPersonaReviewSchema,
  AccessibilityPersonaSchema,
  AccessibilityReviewReportSchema,
  AccessibilityReviewSchema,
  AccessibilitySettingsSchema,
  ActionSchema,
  AndroidTargetSchema,
  BoundsSchema,
  CaseRunSchema,
  CaseStatusSchema,
  collectTags,
  describeTarget,
  filterByTags,
  isUnsettledRun,
  KeyNameSchema,
  resolveModel,
  resolveAccessibility,
  resolveTarget,
  RunSchema,
  RunStatusSchema,
  ScenarioSchema,
  StepSchema,
  SwipeDirectionSchema,
  TargetSchema,
  TestCaseSchema,
  UiNodeSchema,
  UNSETTLED_RUN_STATUSES,
  VerdictSchema,
  WebTargetSchema,
} from "./schema.ts";

export type {
  AccessibilityFinding,
  AccessibilityPersona,
  AccessibilityPersonaReview,
  AccessibilityReview,
  AccessibilityReviewReport,
  AccessibilitySettings,
  Action,
  AndroidTarget,
  Bounds,
  CaseRun,
  CaseStatus,
  KeyName,
  Platform,
  Run,
  RunStatus,
  Scenario,
  ScenarioInput,
  Step,
  SwipeDirection,
  Target,
  TestCase,
  UiNode,
  Verdict,
  WebTarget,
} from "./schema.ts";

export { centerOf, serializeForLlm } from "./serialize.ts";
export type { SerializedUi, UiRef } from "./serialize.ts";

export { loadScenario, loadScenariosDir, ScenarioLoadError } from "./scenario.ts";
