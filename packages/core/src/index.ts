// Everything here is also reachable as `@gemma-e2e/core/schema`, minus the
// loader below. That subpath exists because this entry pulls in node:fs and
// Bun.file through ./scenario.ts, which a browser build cannot typecheck
// against even when it imports nothing but types.
export {
  ActionSchema,
  AndroidTargetSchema,
  BoundsSchema,
  CaseRunSchema,
  describeTarget,
  KeyNameSchema,
  resolveModel,
  resolveTarget,
  RunSchema,
  RunStatusSchema,
  ScenarioSchema,
  StepSchema,
  SwipeDirectionSchema,
  TargetSchema,
  TestCaseSchema,
  UiNodeSchema,
  VerdictSchema,
  WebTargetSchema,
} from "./schema.ts";

export type {
  Action,
  AndroidTarget,
  Bounds,
  CaseRun,
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
