import { loadScenario } from "@gemma-e2e/core";
import type { Scenario } from "@gemma-e2e/core/schema";
import { parseCommand, rejectExtraOperands, requireOperand } from "../args.ts";
import { ApiError, ConnectionError, InvalidServerError } from "../client.ts";
import { type Context, printJson } from "../context.ts";
import { EXIT_ERROR, EXIT_OK, type ExitCode } from "../exit-codes.ts";
import { renderScenario, renderScenarioList } from "../render.ts";
import { answerHelpOrVersion, helpText, PROGRAM, UsageError } from "../usage.ts";

const HELP = helpText({
  usage: [`${PROGRAM} scenario COMMAND [ARG]...`],
  description: "Manage the scenario files the dashboard runs.",
  commands: [
    { flags: "list", description: "list every scenario the server knows" },
    { flags: "get ID", description: "show one scenario and its cases" },
    { flags: "apply FILE...", description: "create or update scenarios from YAML files" },
    { flags: "delete ID", description: "remove a scenario file" },
  ],
});

const SUBCOMMAND_HELP: Record<string, string> = {
  list: helpText({
    usage: [`${PROGRAM} scenario list [OPTION]...`],
    description: "List every scenario the server knows, with its case count.",
  }),
  get: helpText({
    usage: [`${PROGRAM} scenario get [OPTION]... ID`],
    description:
      "Show one scenario and its cases.\n\nThe server has no single-scenario endpoint, so this filters the listing.",
  }),
  apply: helpText({
    usage: [`${PROGRAM} scenario apply [OPTION]... FILE...`],
    description:
      "Create or update a scenario from a YAML file. Each file is validated\nlocally before it is sent, and an existing scenario is updated in place.\n\nWith several files, every one is attempted; the exit status reports whether\nall of them succeeded.",
  }),
  delete: helpText({
    usage: [`${PROGRAM} scenario delete [OPTION]... ID`],
    description: "Remove a scenario file from the server.",
  }),
};

export async function scenarioCommand(
  argv: string[],
  context: Context,
  subcommand: string | null,
): Promise<ExitCode> {
  const isMissing = subcommand === null;
  if (isMissing) {
    throw new UsageError("missing scenario subcommand", ["scenario"]);
  }

  const help = SUBCOMMAND_HELP[subcommand];
  const isKnown = help !== undefined;
  if (!isKnown) {
    throw new UsageError(`unknown scenario subcommand '${subcommand}'`, ["scenario"]);
  }

  const command = ["scenario", subcommand];
  const parsed = parseCommand(argv, {}, command);
  answerHelpOrVersion(parsed.flags, help);

  switch (subcommand) {
    case "list":
      rejectExtraOperands(parsed.operands, 0, command);
      return await listScenarios(context);
    case "get":
      rejectExtraOperands(parsed.operands, 1, command);
      return await getScenario(context, requireOperand(parsed.operands, "scenario id", command));
    case "apply":
      requireOperand(parsed.operands, "scenario file", command);
      return await applyScenarios(context, parsed.operands);
    default:
      rejectExtraOperands(parsed.operands, 1, command);
      return await deleteScenario(context, requireOperand(parsed.operands, "scenario id", command));
  }
}

async function listScenarios(context: Context): Promise<ExitCode> {
  const { scenarios } = await context.client.listScenarios();

  if (context.json) {
    printJson(context, scenarios);
    return EXIT_OK;
  }

  context.out(renderScenarioList(scenarios, context.style));
  return EXIT_OK;
}

async function getScenario(context: Context, id: string): Promise<ExitCode> {
  const { scenarios } = await context.client.listScenarios();
  const found = scenarios.find((scenario) => scenario.id === id);

  const isMissing = found === undefined;
  if (isMissing) {
    context.err(`no such scenario: ${id}`);
    return EXIT_ERROR;
  }

  if (context.json) {
    printJson(context, found);
    return EXIT_OK;
  }

  context.out(renderScenario(found, context.style));
  return EXIT_OK;
}

/**
 * Validates locally, then upserts. Every file is attempted even after one
 * fails on its own merits: `apply scenarios/*.yaml` reporting only the first
 * problem would make fixing a directory a one-error-per-run affair. A failure
 * that is about the server rather than a file stops the whole run instead.
 */
async function applyScenarios(context: Context, paths: string[]): Promise<ExitCode> {
  let failed = false;

  for (const path of paths) {
    let scenario: Scenario;
    try {
      scenario = await loadScenario(path);
    } catch (error) {
      context.err(error instanceof Error ? error.message : String(error));
      failed = true;
      continue;
    }

    try {
      const result = await upsert(context, scenario);
      if (context.json) {
        printJson(context, result);
        continue;
      }
      context.out(`${result.action} ${scenario.id}  ${result.path}`);
    } catch (error) {
      // Why not report these per file like the rest: they are verdicts on the
      // --server value, not on this scenario, so every remaining file would
      // fail identically -- printing the same address once per file, none of
      // which is the file's fault. Rethrown to main's report(), which prints it
      // once with the "gemma-e2e:" prefix the other commands already get.
      const isInvocationWide =
        error instanceof InvalidServerError || error instanceof ConnectionError;
      if (isInvocationWide) {
        throw error;
      }
      context.err(error instanceof Error ? error.message : String(error));
      failed = true;
    }
  }

  return failed ? EXIT_ERROR : EXIT_OK;
}

interface ApplyResult {
  action: "created" | "updated";
  id: string;
  path: string;
}

/**
 * POST first, then PUT on 409.
 *
 * The server deliberately refuses to overwrite through POST because scenario
 * files are git-managed, and it offers no upsert of its own; probing with a
 * listing first would still race, so the conflict is the signal.
 */
async function upsert(context: Context, scenario: Scenario): Promise<ApplyResult> {
  try {
    const created = await context.client.createScenario(scenario);
    return { action: "created", id: scenario.id, path: created.path };
  } catch (error) {
    const isConflict = error instanceof ApiError && error.status === 409;
    if (!isConflict) {
      throw error;
    }
  }

  const updated = await context.client.updateScenario(scenario);
  return { action: "updated", id: scenario.id, path: updated.path };
}

async function deleteScenario(context: Context, id: string): Promise<ExitCode> {
  await context.client.deleteScenario(id);

  if (context.json) {
    printJson(context, { deleted: id });
    return EXIT_OK;
  }

  context.out(`deleted ${id}`);
  return EXIT_OK;
}

export const SCENARIO_HELP = HELP;
