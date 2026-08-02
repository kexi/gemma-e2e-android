import { parseCommand, peekGlobalFlags, splitCommand } from "./args.ts";
import { ConnectionError } from "./client.ts";
import { createContext } from "./context.ts";
import { EXIT_ERROR, type ExitCode } from "./exit-codes.ts";
import { deviceCommand, modelsCommand } from "./commands/misc.ts";
import { RUN_HELP, runCommand } from "./commands/run.ts";
import { scenarioCommand, SCENARIO_HELP } from "./commands/scenario.ts";
import { ExitWithOutput, PROGRAM, ROOT_HELP, UsageError, versionText } from "./usage.ts";

export interface Io {
  out: (line: string) => void;
  err: (line: string) => void;
  env: NodeJS.ProcessEnv;
  isTty: boolean;
}

const NESTED_HELP: Record<string, string> = {
  scenario: SCENARIO_HELP,
  run: RUN_HELP,
};

/**
 * Runs one invocation and returns its exit code. Kept separate from the
 * process entrypoint so tests can drive whole commands without spawning a
 * binary or trapping process.exit.
 */
export async function main(argv: string[], io: Io): Promise<ExitCode> {
  try {
    return await dispatch(argv, io);
  } catch (error) {
    return report(error, io);
  }
}

async function dispatch(argv: string[], io: Io): Promise<ExitCode> {
  const { command, rest } = splitCommand(argv);

  const hasNoCommand = command === null;
  if (hasNoCommand) {
    // Only parsed here when there is no command to hand argv to. Once there is
    // one, --version is left to that command's own strict parser: this one
    // does not know which of its options take a value, so it would read the
    // "--version" in `run start --prompt --version` as a flag.
    const global = parseCommand(rest, {}, []).flags;
    if (global.version) {
      io.out(versionText());
      return 0;
    }
    if (global.help) {
      io.out(ROOT_HELP);
      return 0;
    }
    throw new UsageError("missing command", []);
  }

  // The nested groups take a second operand; the flat ones do not, so their
  // own parser sees the whole remainder.
  const isNested = command === "scenario" || command === "run";
  const nested = isNested ? splitCommand(rest) : { command: null, rest };

  // A bare group ("run --help") has no subcommand to defer to, so its flags are
  // parsed strictly here; with a subcommand present, that command does it.
  const isBareGroup = isNested && nested.command === null;
  if (isBareGroup) {
    const groupFlags = parseCommand(nested.rest, {}, [command]).flags;
    if (groupFlags.version) {
      io.out(versionText());
      return 0;
    }
    if (groupFlags.help) {
      io.out(NESTED_HELP[command] ?? ROOT_HELP);
      return 0;
    }
  }

  const context = createContext({
    flags: peekGlobalFlags(nested.rest),
    env: io.env,
    isTty: io.isTty,
    out: io.out,
    err: io.err,
  });

  switch (command) {
    case "scenario":
      return await scenarioCommand(nested.rest, context, nested.command);
    case "run":
      return await runCommand(nested.rest, context, nested.command);
    case "models":
      return await modelsCommand(rest, context);
    case "device":
      return await deviceCommand(rest, context);
    default:
      throw new UsageError(`unknown command '${command}'`, []);
  }
}

function report(error: unknown, io: Io): ExitCode {
  const isOutput = error instanceof ExitWithOutput;
  if (isOutput) {
    io.out(error.output);
    return 0;
  }

  const isUsage = error instanceof UsageError;
  if (isUsage) {
    io.err(`${PROGRAM}: ${error.message}`);
    const path = [PROGRAM, ...error.command].join(" ");
    io.err(`Try '${path} --help' for more information.`);
    return EXIT_ERROR;
  }

  const isConnection = error instanceof ConnectionError;
  if (isConnection) {
    io.err(`${PROGRAM}: ${error.message}`);
    return EXIT_ERROR;
  }

  // InvalidServerError needs no branch of its own: the fallback below already
  // prints "gemma-e2e: <msg>" and exits 2, and unlike UsageError it must not
  // gain a "--help" hint.

  io.err(`${PROGRAM}: ${error instanceof Error ? error.message : String(error)}`);
  return EXIT_ERROR;
}

// Guarded so importing this module from a test does not execute the CLI.
const isEntrypoint = import.meta.main;
if (isEntrypoint) {
  // Written to the streams directly rather than through console.log/error:
  // Bun's console.error paints everything red when stderr is a TTY, which no
  // flag of ours can switch off, so --no-color left the error path coloured
  // while the rest of the output obeyed it.
  const code = await main(process.argv.slice(2), {
    out: (line) => {
      process.stdout.write(`${line}\n`);
    },
    err: (line) => {
      process.stderr.write(`${line}\n`);
    },
    env: process.env,
    isTty: process.stdout.isTTY === true,
  });
  process.exit(code);
}
