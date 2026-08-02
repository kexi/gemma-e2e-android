import { parseArgs, type ParseArgsConfig } from "node:util";
import { UsageError } from "./usage.ts";

type OptionConfig = NonNullable<ParseArgsConfig["options"]>;

/** Accepted by every command, so each one's own options are merged onto these. */
export const GLOBAL_OPTION_CONFIG = {
  server: { type: "string" },
  json: { type: "boolean" },
  "no-color": { type: "boolean" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "V" },
} as const satisfies OptionConfig;

export interface GlobalFlags {
  server: string | undefined;
  json: boolean;
  noColor: boolean;
  help: boolean;
  version: boolean;
}

export interface Parsed<T> {
  flags: GlobalFlags;
  options: T;
  operands: string[];
}

/**
 * Parses one command's argv.
 *
 * `allowPositionals` with strict parsing is what gives free ordering: parseArgs
 * keeps scanning for options after the first operand and honours `--` as the
 * terminator, so `run start -w login` and `run start login -w` are the same
 * command and `-- -w` is a literal operand.
 */
export function parseCommand<T extends Record<string, unknown>>(
  argv: string[],
  options: OptionConfig,
  command: string[],
): Parsed<T> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: argv,
      options: { ...GLOBAL_OPTION_CONFIG, ...options },
      allowPositionals: true,
      strict: true,
    });
  } catch (error) {
    // parseArgs' own messages already name the offending flag; rewrapping keeps
    // the "Try --help" hint attached to the command the user actually typed.
    throw new UsageError(error instanceof Error ? error.message : String(error), command);
  }

  const values = parsed.values as Record<string, unknown>;
  return {
    flags: {
      server: typeof values.server === "string" ? values.server : undefined,
      json: values.json === true,
      noColor: values["no-color"] === true,
      help: values.help === true,
      version: values.version === true,
    },
    options: values as T,
    operands: parsed.positionals,
  };
}

/**
 * Splits the global argv at the first operand, which is the subcommand name.
 *
 * Non-strict so an unknown option belonging to a subcommand does not abort
 * here; the subcommand re-parses its own slice strictly and reports it with the
 * right help text.
 */
export function splitCommand(argv: string[]): { command: string | null; rest: string[] } {
  const { tokens } = parseArgs({
    args: argv,
    options: GLOBAL_OPTION_CONFIG,
    allowPositionals: true,
    strict: false,
    tokens: true,
  });

  const first = tokens.find((token) => token.kind === "positional");
  const hasCommand = first !== undefined;
  if (!hasCommand) {
    return { command: null, rest: argv };
  }

  // Everything but the command name is forwarded, so global flags written
  // before it ("--json scenario list") reach the subcommand parser too.
  const rest = [...argv.slice(0, first.index), ...argv.slice(first.index + 1)];
  return { command: first.value, rest };
}

/**
 * Reads the global flags without judging the rest of argv.
 *
 * Non-strict on purpose: this runs before the subcommand parser, so rejecting
 * an unknown option here would report it against the top-level help instead of
 * the command the user actually typed.
 */
export function peekGlobalFlags(argv: string[]): GlobalFlags {
  const { values } = parseArgs({
    args: argv,
    options: GLOBAL_OPTION_CONFIG,
    allowPositionals: true,
    strict: false,
  });

  return {
    server: typeof values.server === "string" ? values.server : undefined,
    json: values.json === true,
    noColor: values["no-color"] === true,
    help: values.help === true,
    version: values.version === true,
  };
}

export function requireOperand(operands: string[], name: string, command: string[]): string {
  const first = operands[0];
  const isMissing = first === undefined;
  if (isMissing) {
    throw new UsageError(`missing ${name}`, command);
  }
  return first;
}

export function rejectExtraOperands(operands: string[], allowed: number, command: string[]): void {
  const hasExtra = operands.length > allowed;
  if (hasExtra) {
    throw new UsageError(`unexpected argument '${operands[allowed] ?? ""}'`, command);
  }
}
