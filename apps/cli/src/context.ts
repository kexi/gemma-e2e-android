import { ApiClient } from "./client.ts";
import type { GlobalFlags } from "./args.ts";
import { type Style, styleFor } from "./render.ts";
import { resolveServer } from "./client.ts";

/**
 * Everything a command needs from the outside world. Passed rather than
 * imported so tests can drive a command against a throwaway server and collect
 * its output without touching process streams.
 */
export interface Context {
  client: ApiClient;
  json: boolean;
  style: Style;
  out: (line: string) => void;
  err: (line: string) => void;
  env: NodeJS.ProcessEnv;
}

export function createContext(input: {
  flags: GlobalFlags;
  env: NodeJS.ProcessEnv;
  isTty: boolean;
  out: (line: string) => void;
  err: (line: string) => void;
}): Context {
  return {
    client: new ApiClient(resolveServer(input.flags.server, input.env)),
    json: input.flags.json,
    style: styleFor({ noColor: input.flags.noColor, isTty: input.isTty, env: input.env }),
    out: input.out,
    err: input.err,
    env: input.env,
  };
}

/** `--json` output is one document per line so it stays pipeable into jq. */
export function printJson(context: Context, value: unknown): void {
  context.out(JSON.stringify(value));
}
