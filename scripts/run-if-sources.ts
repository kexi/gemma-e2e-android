#!/usr/bin/env bun
/**
 * Runs a workspace-wide tool, but exits 0 when the workspace holds no source
 * files yet.
 *
 * oxlint ("No files found to lint"), oxfmt ("Expected at least one target
 * file"), and `bun run --filter` ("No packages matched the filter") all treat
 * an empty target set as an error. That is right once apps/ and packages/ are
 * populated, but during bootstrap it makes `just check` and CI fail on a repo
 * that is simply empty. Guarding here keeps the failure meaningful later
 * without special-casing each tool's exit codes.
 *
 * Usage:
 *   run-if-sources.ts <tool> [args...]   run `<tool> [args] apps packages`
 *   run-if-sources.ts --typecheck        run `bun run --filter '*' typecheck`
 */

import { Glob } from "bun";

const WORKSPACE_DIRS = ["apps", "packages"] as const;
const SOURCE_PATTERN = "**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}";

async function hasSources(): Promise<boolean> {
  const glob = new Glob(SOURCE_PATTERN);
  for (const dir of WORKSPACE_DIRS) {
    for await (const _ of glob.scan({ cwd: dir, onlyFiles: true })) {
      return true;
    }
  }
  return false;
}

const args = process.argv.slice(2);

const hasNoArgs = args.length === 0;
if (hasNoArgs) {
  console.error("run-if-sources: expected a tool name or --typecheck");
  process.exit(2);
}

const workspaceIsEmpty = !(await hasSources());
if (workspaceIsEmpty) {
  console.log(`No source files under ${WORKSPACE_DIRS.join("/")}; skipping ${args.join(" ")}.`);
  process.exit(0);
}

const isTypecheck = args[0] === "--typecheck";
const command = isTypecheck
  ? ["bun", "run", "--filter", "*", "typecheck"]
  : [...args, ...WORKSPACE_DIRS];

const proc = Bun.spawn(command, { stdout: "inherit", stderr: "inherit" });
process.exit(await proc.exited);
