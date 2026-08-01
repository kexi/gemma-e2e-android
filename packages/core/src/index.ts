// Everything here is also reachable as `@gemma-e2e/core/schema`, minus the
// loader below. That subpath exists because this entry pulls in node:fs and
// Bun.file through ./scenario.ts, which a browser build cannot typecheck
// against even when it imports nothing but types.
export {
  ActionSchema,
  BoundsSchema,
  KeyNameSchema,
  RunSchema,
  RunStatusSchema,
  ScenarioSchema,
  StepSchema,
  SwipeDirectionSchema,
  UiNodeSchema,
  VerdictSchema,
} from "./schema.ts";

export type {
  Action,
  Bounds,
  KeyName,
  Run,
  RunStatus,
  Scenario,
  ScenarioInput,
  Step,
  SwipeDirection,
  UiNode,
  Verdict,
} from "./schema.ts";

export { loadScenario, loadScenariosDir, ScenarioLoadError } from "./scenario.ts";
