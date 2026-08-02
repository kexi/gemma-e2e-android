import { describe, expect, test } from "bun:test";
import { readSse, SseParser, toRunEvent } from "./sse.ts";
import { sseFrame, sseResponse } from "./testing.ts";

describe("SseParser", () => {
  test("parses a complete frame into its event name and data", () => {
    const parser = new SseParser();

    expect(parser.push('event: run_finished\ndata: {"status":"passed"}\n\n')).toEqual([
      { event: "run_finished", data: '{"status":"passed"}' },
    ]);
  });

  test("reassembles a frame split across chunk boundaries", () => {
    const parser = new SseParser();

    expect(parser.push("event: case_st")).toEqual([]);
    expect(parser.push('arted\ndata: {"case')).toEqual([]);
    expect(parser.push('Id":"login"}\n')).toEqual([]);
    expect(parser.push("\n")).toEqual([{ event: "case_started", data: '{"caseId":"login"}' }]);
  });

  test("parses several frames arriving in one chunk", () => {
    const parser = new SseParser();

    const messages = parser.push(
      `${sseFrame("case_started", { caseId: "a" })}${sseFrame("case_finished", { caseId: "a" })}`,
    );

    expect(messages.map((m) => m.event)).toEqual(["case_started", "case_finished"]);
  });

  test("accepts CRLF line endings", () => {
    const parser = new SseParser();

    expect(parser.push('event: run_finished\r\ndata: {"status":"failed"}\r\n\r\n')).toEqual([
      { event: "run_finished", data: '{"status":"failed"}' },
    ]);
  });

  test("joins multi-line data with newlines", () => {
    const parser = new SseParser();

    expect(parser.push("event: note\ndata: first\ndata: second\n\n")).toEqual([
      { event: "note", data: "first\nsecond" },
    ]);
  });

  test("ignores keep-alive comments without disturbing the frame around them", () => {
    const parser = new SseParser();

    expect(parser.push(": keep-alive\n\n")).toEqual([]);
    expect(parser.push("event: ping\ndata: 1\n\n")).toEqual([{ event: "ping", data: "1" }]);
  });

  test("defaults the event name to `message` when the frame carries only data", () => {
    const parser = new SseParser();

    expect(parser.push("data: bare\n\n")).toEqual([{ event: "message", data: "bare" }]);
  });

  test("does not carry an event name from one frame into the next", () => {
    const parser = new SseParser();

    parser.push("event: named\ndata: 1\n\n");

    expect(parser.push("data: 2\n\n")).toEqual([{ event: "message", data: "2" }]);
  });

  test("keeps a value that contains colons intact", () => {
    const parser = new SseParser();

    expect(parser.push('data: {"url":"http://x.test:5175"}\n\n')).toEqual([
      { event: "message", data: '{"url":"http://x.test:5175"}' },
    ]);
  });
});

describe("readSse", () => {
  test("yields every frame of a stream in order", async () => {
    const response = sseResponse([
      sseFrame("case_started", { type: "case_started", caseId: "a" }),
      sseFrame("run_finished", { type: "run_finished", status: "passed" }),
    ]);

    const events = [];
    for await (const message of readSse(response)) {
      events.push(message.event);
    }

    expect(events).toEqual(["case_started", "run_finished"]);
  });

  test("yields nothing for a response with no body", async () => {
    const events = [];
    for await (const message of readSse(new Response(null, { status: 204 }))) {
      events.push(message);
    }

    expect(events).toEqual([]);
  });
});

describe("toRunEvent", () => {
  test("parses a well-formed frame into a run event", () => {
    expect(toRunEvent({ event: "run_finished", data: '{"type":"run_finished"}' })).toEqual({
      type: "run_finished",
    } as never);
  });

  test("drops a frame whose data is not valid JSON", () => {
    expect(toRunEvent({ event: "run_finished", data: "{oops" })).toBeNull();
  });
});
