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
  let client: ApiClient | null = null;

  return {
    // Why not resolve the server here: --help and --version are answered inside
    // each command, after the strict parse that is the only one able to tell
    // `run start --prompt --version` apart from a real --version. The context
    // has to exist before that parse runs, so validating eagerly here failed
    // `run start --help` over a --server the help path never reads. Deferred to
    // first use instead, which is where a bad address actually matters: the
    // getter still throws InvalidServerError, so every request path reports it
    // exactly as before.
    //
    // Why not rebuild per access: a run is followed across several reads of
    // this property, and handing out a fresh client each time would discard any
    // per-client state a future change puts there.
    get client() {
      client ??= new ApiClient(resolveServer(input.flags.server, input.env));
      return client;
    },
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
