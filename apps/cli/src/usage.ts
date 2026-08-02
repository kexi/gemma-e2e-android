export const PROGRAM = "gemma-e2e";
export const VERSION = "0.1.0";

/**
 * A usage mistake, as opposed to a request that reached the server and failed.
 * Only these get the "Try 'gemma-e2e --help'" hint, per the GNU guidelines.
 */
export class UsageError extends Error {
  override readonly name = "UsageError";

  constructor(
    message: string,
    /** The subcommand path whose help to point at, e.g. ["run", "start"]. */
    readonly command: string[] = [],
  ) {
    super(message);
  }
}

/** Raised by --help and --version, which are successful exits, not failures. */
export class ExitWithOutput extends Error {
  override readonly name = "ExitWithOutput";

  constructor(readonly output: string) {
    super(output);
  }
}

/**
 * Answers --help / --version for a command that has already parsed its own
 * argv, which is the only parse that knows which of its options take a value.
 */
export function answerHelpOrVersion(
  flags: { help: boolean; version: boolean },
  help: string,
): void {
  if (flags.version) {
    throw new ExitWithOutput(versionText());
  }
  if (flags.help) {
    throw new ExitWithOutput(help);
  }
}

export function versionText(): string {
  return [
    `${PROGRAM} ${VERSION}`,
    "",
    "Copyright (C) 2026 Kei Nakayama.",
    "License MIT: <https://opensource.org/licenses/MIT>.",
    "This is free software: you are free to change and redistribute it.",
    "There is NO WARRANTY, to the extent permitted by law.",
  ].join("\n");
}

export interface OptionDoc {
  flags: string;
  description: string;
}

export const GLOBAL_OPTIONS: OptionDoc[] = [
  { flags: "    --server=URL", description: "dashboard API base URL" },
  { flags: "    --json", description: "print raw JSON instead of a table" },
  { flags: "    --no-color", description: "disable coloured output" },
  { flags: "-h, --help", description: "display this help and exit" },
  { flags: "-V, --version", description: "output version information and exit" },
];

/** Aligns the flag column to the widest entry, the way GNU tools lay out --help. */
export function optionList(options: OptionDoc[]): string {
  const width = Math.max(...options.map((option) => option.flags.length));
  return options
    .map((option) => `  ${option.flags.padEnd(width)}  ${option.description}`)
    .join("\n");
}

export function helpText(input: {
  usage: string[];
  description: string;
  options?: OptionDoc[];
  commands?: OptionDoc[];
  footer?: string[];
}): string {
  const sections: string[] = [];

  const [first, ...rest] = input.usage;
  sections.push([`Usage: ${first}`, ...rest.map((line) => `   or: ${line}`)].join("\n"));
  sections.push(input.description);

  const hasCommands = input.commands !== undefined && input.commands.length > 0;
  if (hasCommands) {
    sections.push(`Commands:\n${optionList(input.commands as OptionDoc[])}`);
  }

  const options = [...(input.options ?? []), ...GLOBAL_OPTIONS];
  sections.push(`Options:\n${optionList(options)}`);

  const hasFooter = input.footer !== undefined && input.footer.length > 0;
  if (hasFooter) {
    sections.push((input.footer as string[]).join("\n"));
  }

  return sections.join("\n\n");
}

export const ROOT_HELP = helpText({
  usage: [`${PROGRAM} [OPTION]... COMMAND [ARG]...`],
  description:
    "Drive the gemma-e2e Android dashboard from the terminal: manage scenarios,\nstart runs, and follow them to a verdict.",
  commands: [
    { flags: "scenario", description: "list, show, apply, or delete scenarios" },
    { flags: "run", description: "start, list, show, or watch runs" },
    { flags: "models", description: "list the models the LLM endpoint serves" },
    { flags: "device", description: "show the connected emulator's status" },
  ],
  footer: [
    "The server is taken from --server, then GEMMA_E2E_SERVER, then",
    "http://127.0.0.1:5175.",
    "",
    "Exit status:",
    "  0  the command succeeded, or the run passed",
    "  1  the run failed",
    "  2  the command could not be carried out",
    "",
    `Run '${PROGRAM} COMMAND --help' for help on a specific command.`,
  ],
});
