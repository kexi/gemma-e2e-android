import type { Action, CaseRun, RunStatus, Scenario, Step } from "@gemma-e2e/core/schema";

/**
 * Mirrors `RunEvent` in packages/agent/src/run.ts:72-96.
 *
 * Redeclared rather than imported: pulling in @gemma-e2e/agent would drag
 * Genkit and its transitive tree into a `bun build --compile` binary whose only
 * job is to speak HTTP. Moving the union into @gemma-e2e/core is the follow-up
 * that would let this file go away.
 */
export type RunEvent =
  | { type: "run_started"; runId: string; scenario: Scenario }
  | { type: "case_started"; runId: string; caseId: string; caseRun: CaseRun }
  | { type: "step_started"; runId: string; caseId: string; index: number }
  | { type: "ui_captured"; runId: string; caseId: string; index: number; uiText: string }
  | {
      type: "action_decided";
      runId: string;
      caseId: string;
      index: number;
      action: Action;
      llmDurationMs: number;
    }
  | { type: "action_executed"; runId: string; caseId: string; index: number; action: Action }
  | { type: "step_recorded"; runId: string; caseId: string; step: Step }
  | {
      type: "case_finished";
      runId: string;
      caseId: string;
      status: RunStatus;
      reason: string | null;
      videoPath: string | null;
    }
  | { type: "run_finished"; runId: string; status: RunStatus; reason: string | null };

export interface SseMessage {
  event: string;
  data: string;
}

/**
 * Incremental `text/event-stream` parser.
 *
 * Written by hand because Bun ships no EventSource, and because EventSource
 * would be the wrong tool even if it did: it reconnects on its own, which for a
 * run stream that legitimately ends at `run_finished` means an endless loop of
 * replays.
 */
export class SseParser {
  #buffer = "";
  #event: string | null = null;
  #data: string[] = [];

  /** Feeds a chunk and returns whichever messages it completed. */
  push(chunk: string): SseMessage[] {
    this.#buffer += chunk;
    const messages: SseMessage[] = [];

    // A line is only complete once its terminator has arrived; whatever
    // follows the last newline stays buffered for the next chunk, which is
    // what makes a frame split mid-field parse the same as an intact one.
    for (;;) {
      const newline = this.#buffer.indexOf("\n");
      const isPartial = newline === -1;
      if (isPartial) {
        break;
      }
      const raw = this.#buffer.slice(0, newline);
      this.#buffer = this.#buffer.slice(newline + 1);
      const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
      const completed = this.#line(line);
      if (completed !== null) {
        messages.push(completed);
      }
    }

    return messages;
  }

  #line(line: string): SseMessage | null {
    const isDispatch = line === "";
    if (isDispatch) {
      return this.#dispatch();
    }

    // Per the spec a leading colon is a comment; hono/streaming sends these as
    // keep-alives, so dropping them silently is required, not merely tidy.
    const isComment = line.startsWith(":");
    if (isComment) {
      return null;
    }

    const colon = line.indexOf(":");
    const hasValue = colon !== -1;
    const field = hasValue ? line.slice(0, colon) : line;
    const rest = hasValue ? line.slice(colon + 1) : "";
    const value = rest.startsWith(" ") ? rest.slice(1) : rest;

    const isEvent = field === "event";
    if (isEvent) {
      this.#event = value;
      return null;
    }
    const isData = field === "data";
    if (isData) {
      this.#data.push(value);
    }
    return null;
  }

  #dispatch(): SseMessage | null {
    const isEmpty = this.#data.length === 0;
    if (isEmpty) {
      // A blank line with nothing buffered still resets the event name, or a
      // keep-alive between frames would leak it into the next message.
      this.#event = null;
      return null;
    }
    const message: SseMessage = { event: this.#event ?? "message", data: this.#data.join("\n") };
    this.#event = null;
    this.#data = [];
    return message;
  }
}

/**
 * Reads a response body as SSE messages. The stream ends when the server
 * closes it, which for `/api/runs/:id/events` is right after `run_finished`.
 */
export async function* readSse(response: Response): AsyncGenerator<SseMessage> {
  const body = response.body;
  const hasBody = body !== null;
  if (!hasBody) {
    return;
  }

  const parser = new SseParser();
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        return;
      }
      for (const message of parser.push(value)) {
        yield message;
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

/** Messages whose `data` did not parse are dropped: a half-written frame is not a run event. */
export function toRunEvent(message: SseMessage): RunEvent | null {
  try {
    return JSON.parse(message.data) as RunEvent;
  } catch {
    return null;
  }
}
