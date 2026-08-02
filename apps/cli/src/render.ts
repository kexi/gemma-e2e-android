import type { Action, Run, RunStatus, Scenario } from "@gemma-e2e/core/schema";
import type { DeviceStatus, ModelInfo } from "./client.ts";
import type { RunEvent } from "./sse.ts";

const RESET = "[0m";
const CODES = {
  green: "[32m",
  red: "[31m",
  yellow: "[33m",
  cyan: "[36m",
  dim: "[2m",
} as const;

export type Color = keyof typeof CODES;

export interface Style {
  (text: string, color: Color): string;
}

export const plain: Style = (text) => text;

export const colored: Style = (text, color) => `${CODES[color]}${text}${RESET}`;

/**
 * Colour is off unless every signal says otherwise. `NO_COLOR` is honoured for
 * any value including the empty string, as no-color.org specifies.
 */
export function styleFor(options: {
  noColor: boolean;
  isTty: boolean;
  env: NodeJS.ProcessEnv;
}): Style {
  const isSuppressed = options.noColor || !options.isTty || options.env.NO_COLOR !== undefined;
  return isSuppressed ? plain : colored;
}

export function statusColor(status: RunStatus): Color {
  const isPassed = status === "passed";
  if (isPassed) {
    return "green";
  }
  const isFailed = status === "failed";
  if (isFailed) {
    return "red";
  }
  const isRunning = status === "running";
  return isRunning ? "cyan" : "yellow";
}

/**
 * Left-aligned columns padded to the widest cell, with a two-space gutter.
 * Trailing whitespace is trimmed so the output diffs cleanly and copies without
 * invisible padding.
 */
export function table(rows: string[][]): string {
  const isEmpty = rows.length === 0;
  if (isEmpty) {
    return "";
  }

  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, index) => {
      widths[index] = Math.max(widths[index] ?? 0, cell.length);
    });
  }

  return rows
    .map((row) =>
      row
        .map((cell, index) => (index === row.length - 1 ? cell : cell.padEnd(widths[index] ?? 0)))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}

export function renderScenarioList(scenarios: Scenario[], style: Style): string {
  const isEmpty = scenarios.length === 0;
  if (isEmpty) {
    return "No scenarios.";
  }

  const header = ["ID", "TITLE", "CASES", "MODEL"].map((cell) => style(cell, "dim"));
  const rows = scenarios.map((scenario) => [
    scenario.id,
    scenario.title,
    String(scenario.cases.length),
    scenario.model ?? "-",
  ]);
  return table([header, ...rows]);
}

export function renderScenario(scenario: Scenario, style: Style): string {
  const lines = [
    `${style("id", "dim")}     ${scenario.id}`,
    `${style("title", "dim")}  ${scenario.title}`,
  ];

  const hasApp = scenario.app !== undefined;
  if (hasApp) {
    const activity = scenario.app?.activity;
    const suffix = activity === undefined ? "" : `/${activity}`;
    lines.push(`${style("app", "dim")}    ${scenario.app?.package}${suffix}`);
  }

  const hasModel = scenario.model !== undefined;
  if (hasModel) {
    lines.push(`${style("model", "dim")}  ${scenario.model}`);
  }

  lines.push("", style(`cases (${scenario.cases.length})`, "dim"));
  for (const testCase of scenario.cases) {
    lines.push(`  ${testCase.id}  ${testCase.title ?? testCase.prompt}`);
  }
  return lines.join("\n");
}

export function renderRunList(runs: Run[], style: Style): string {
  const isEmpty = runs.length === 0;
  if (isEmpty) {
    return "No runs.";
  }

  const header = ["RUN ID", "SCENARIO", "STATUS", "STARTED"].map((cell) => style(cell, "dim"));
  const rows = runs.map((run) => [
    run.id,
    run.scenarioId,
    style(run.status, statusColor(run.status)),
    run.startedAt,
  ]);
  return table([header, ...rows]);
}

export function renderRun(run: Run, style: Style): string {
  const lines = [
    `${style("run", "dim")}       ${run.id}`,
    `${style("scenario", "dim")}  ${run.scenarioId}`,
    `${style("title", "dim")}     ${run.title}`,
    `${style("status", "dim")}    ${style(run.status, statusColor(run.status))}`,
    `${style("started", "dim")}   ${run.startedAt}`,
  ];

  const hasFinished = run.finishedAt !== null;
  if (hasFinished) {
    lines.push(`${style("finished", "dim")}  ${run.finishedAt}`);
  }
  const hasReason = run.verdictReason !== null;
  if (hasReason) {
    lines.push(`${style("reason", "dim")}    ${run.verdictReason}`);
  }

  for (const caseRun of run.cases) {
    const badge = style(caseRun.status, statusColor(caseRun.status));
    lines.push("", `${badge}  ${caseRun.caseId}  ${caseRun.title}`);
    const hasCaseReason = caseRun.verdictReason !== null;
    if (hasCaseReason) {
      lines.push(`  ${style("reason", "dim")}  ${caseRun.verdictReason}`);
    }
    for (const step of caseRun.steps) {
      lines.push(`  ${String(step.index).padStart(3)}  ${describeAction(step.action)}`);
    }
  }

  return lines.join("\n");
}

export function describeAction(action: Action): string {
  switch (action.type) {
    case "tap":
      return `tap [${action.ref}]`;
    case "input_text":
      return `input_text [${action.ref}] ${JSON.stringify(action.text)}`;
    case "swipe":
      return `swipe ${action.direction}`;
    case "key_event":
      return `key_event ${action.key}`;
    case "wait":
      return `wait ${action.ms}ms`;
    case "remember":
      return `remember ${JSON.stringify(action.text)}`;
    case "finish":
      return `finish ${action.verdict}: ${action.reason}`;
  }
}

/**
 * One line per interesting event, or null for the ones the terminal should not
 * show. `ui_captured` carries a whole serialized UI tree, and `step_started` /
 * `action_executed` / `action_decided` restate what `step_recorded` already
 * said.
 *
 * *Why not render `action_decided` instead, or as well:* it is the only event
 * carrying `llmDurationMs`, so it is the tempting one — but the server replays a
 * stored timeline as `step_recorded` frames alone (apps/web/server/app.ts), and
 * a live run emits both for every step. Rendering `action_decided` leaves
 * `run watch` on a finished run printing no steps at all; rendering both prints
 * every live step twice. `step_recorded` is the one frame present on both paths,
 * so it is the one drawn, and the decision timing is given up with it. The
 * dashboard resolves the same conflict the same way (apps/web/src/pages/RunPage.tsx).
 */
export function renderEvent(event: RunEvent, style: Style): string | null {
  switch (event.type) {
    case "run_started":
      return `${style("run", "cyan")}  ${event.scenario.title} (${event.scenario.cases.length} cases)`;
    case "case_started":
      return `${style("case", "cyan")}  ${event.caseId}  ${event.caseRun.title}`;
    case "step_recorded":
      return `  ${String(event.step.index).padStart(3)}  ${describeAction(event.step.action)}`;
    case "case_finished": {
      const reason = event.reason === null ? "" : `  ${event.reason}`;
      return `${style(event.status, statusColor(event.status))}  ${event.caseId}${reason}`;
    }
    case "run_finished": {
      const reason = event.reason === null ? "" : `  ${event.reason}`;
      return `${style(event.status, statusColor(event.status))}  run ${event.runId}${reason}`;
    }
    default:
      return null;
  }
}

export function renderModels(models: ModelInfo[]): string {
  const isEmpty = models.length === 0;
  return isEmpty ? "No models." : models.map((model) => model.id).join("\n");
}

export function renderDevice(device: DeviceStatus, style: Style): string {
  const lines = [
    `${style("booted", "dim")}  ${style(String(device.booted), device.booted ? "green" : "yellow")}`,
    `${style("uptime", "dim")}  ${device.uptimeMs === null ? "-" : `${Math.round(device.uptimeMs / 1000)}s`}`,
  ];

  const entries = Object.entries(device.hardwareConfig).sort(([a], [b]) => a.localeCompare(b));
  const hasConfig = entries.length > 0;
  if (hasConfig) {
    lines.push("", style("hardware", "dim"));
    lines.push(table(entries.map(([key, value]) => [`  ${key}`, value])));
  }
  return lines.join("\n");
}
