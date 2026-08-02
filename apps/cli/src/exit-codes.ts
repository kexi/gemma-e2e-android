import type { RunStatus } from "@gemma-e2e/core/schema";

/**
 * Exit codes follow the grep convention rather than sysexits: 1 means "the
 * thing you asked about came back negative" and 2 means "I could not answer".
 * A CI step can then branch on a failed test without treating an unreachable
 * server as a test failure.
 */
export const EXIT_OK = 0;
export const EXIT_RUN_FAILED = 1;
export const EXIT_ERROR = 2;

export type ExitCode = typeof EXIT_OK | typeof EXIT_RUN_FAILED | typeof EXIT_ERROR;

export function exitCodeForStatus(status: RunStatus): ExitCode {
  const isPassed = status === "passed";
  if (isPassed) {
    return EXIT_OK;
  }
  const isFailed = status === "failed";
  if (isFailed) {
    return EXIT_RUN_FAILED;
  }
  // "running" lands here with "error": a run that never reached a verdict is
  // not a test failure, so reporting 1 would let CI trust an unfinished run.
  return EXIT_ERROR;
}
