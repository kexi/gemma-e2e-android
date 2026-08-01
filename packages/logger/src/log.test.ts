import { describe, expect, test } from "bun:test";
import {
  createLogger,
  errorFields,
  type LogEvent,
  LogEventSchema,
  type LogLevel,
  noopLogger,
  parseLogLevel,
} from "./log.ts";

/** Collects written lines and parses them back, as a real consumer would. */
function collector(): { lines: string[]; sink: (line: string) => void; events: () => LogEvent[] } {
  const lines: string[] = [];
  return {
    lines,
    sink: (line) => lines.push(line),
    events: () => lines.map((line) => JSON.parse(line) as LogEvent),
  };
}

const FIXED_TS = "2026-08-01T00:00:00.000Z";
const fixedNow = () => new Date(FIXED_TS);

describe("LogEventSchema", () => {
  test("accepts the fixed spine plus arbitrary JSON fields", () => {
    const result = LogEventSchema.safeParse({
      ts: FIXED_TS,
      level: "info",
      event: "run.started",
      runId: "r1",
      steps: 3,
      ok: true,
      nested: { a: [1, "two", null] },
    });

    expect(result.success).toBe(true);
  });

  test.each([
    ["a missing timestamp", { level: "info", event: "run.started" }],
    ["a timestamp that is not ISO 8601", { ts: "yesterday", level: "info", event: "run.started" }],
    ["an unknown level", { ts: FIXED_TS, level: "trace", event: "run.started" }],
    ["an event without a namespace", { ts: FIXED_TS, level: "info", event: "started" }],
    ["an event with uppercase", { ts: FIXED_TS, level: "info", event: "Run.Started" }],
    ["a non-JSON field value", { ts: FIXED_TS, level: "info", event: "run.started", n: NaN }],
    [
      "a field holding a function",
      { ts: FIXED_TS, level: "info", event: "run.started", fn: () => {} },
    ],
  ])("rejects %s", (_label, candidate) => {
    expect(LogEventSchema.safeParse(candidate).success).toBe(false);
  });
});

describe("createLogger", () => {
  test("writes one parseable JSON line carrying ts, level and event", () => {
    const out = collector();
    const log = createLogger({ sink: out.sink, now: fixedNow });

    log.info("http.request", { method: "GET", path: "/api/scenarios", status: 200 });

    expect(out.lines).toHaveLength(1);
    expect(out.lines[0]).not.toContain("\n");
    expect(out.events()[0]).toEqual({
      ts: FIXED_TS,
      level: "info",
      event: "http.request",
      method: "GET",
      path: "/api/scenarios",
      status: 200,
    });
  });

  test("leads every line with ts, level and event", () => {
    const out = collector();
    const log = createLogger({ sink: out.sink, now: fixedNow, bindings: { service: "web" } });

    log.info("http.request", { status: 200 });

    expect(Object.keys(JSON.parse(out.lines[0] as string) as object).slice(0, 3)).toEqual([
      "ts",
      "level",
      "event",
    ]);
  });

  test("keeps the spine honest when a field shadows it", () => {
    const out = collector();
    const log = createLogger({ sink: out.sink, now: fixedNow });

    log.error("run.failed", { level: "debug", event: "spoofed", ts: "1999-01-01T00:00:00.000Z" });

    expect(out.events()[0]).toMatchObject({
      ts: FIXED_TS,
      level: "error",
      event: "run.failed",
    });
  });

  test("emits every line as its own NDJSON record", () => {
    const out = collector();
    const log = createLogger({ sink: out.sink, level: "debug", now: fixedNow });

    log.debug("adb.exec", { argv: ["adb", "devices"] });
    log.warn("adb.slow", { ms: 1200 });
    log.error("run.failed", { runId: "r1" });

    expect(out.lines).toHaveLength(3);
    expect(out.events().map((e) => [e.level, e.event])).toEqual([
      ["debug", "adb.exec"],
      ["warn", "adb.slow"],
      ["error", "run.failed"],
    ]);
  });

  test("drops events below the configured level", () => {
    const out = collector();
    const log = createLogger({ sink: out.sink, level: "warn", now: fixedNow });

    log.debug("run.step", {});
    log.info("run.step", {});
    log.warn("run.step", {});
    log.error("run.step", {});

    expect(out.events().map((e) => e.level)).toEqual(["warn", "error"]);
  });

  test("omits fields that are undefined rather than writing null", () => {
    const out = collector();
    const log = createLogger({ sink: out.sink, now: fixedNow });

    log.info("run.finished", { runId: "r1", reason: undefined });

    expect(out.events()[0]).not.toHaveProperty("reason");
  });

  test("warns before an invalid event but still writes it", () => {
    const out = collector();
    const log = createLogger({ sink: out.sink, now: fixedNow });

    log.info("run.step", { ratio: Number.NaN });

    expect(out.lines).toHaveLength(2);
    const [warning, original] = out.events();
    expect(warning).toMatchObject({
      level: "warn",
      event: "log.invalid_event",
      invalidEvent: "run.step",
      invalidPaths: "ratio",
    });
    expect(original?.event).toBe("run.step");
  });
});

describe("child loggers", () => {
  test("merge the parent's bindings into every event", () => {
    const out = collector();
    const log = createLogger({ sink: out.sink, now: fixedNow, bindings: { service: "web" } });
    const runLog = log.child({ runId: "r1" });

    runLog.info("run.started", { scenarioId: "login" });

    expect(out.events()[0]).toEqual({
      ts: FIXED_TS,
      level: "info",
      event: "run.started",
      service: "web",
      runId: "r1",
      scenarioId: "login",
    });
  });

  test("nest, with the innermost binding winning", () => {
    const out = collector();
    const log = createLogger({ sink: out.sink, now: fixedNow, bindings: { scope: "root" } });

    log.child({ scope: "middle" }).child({ scope: "leaf" }).info("run.step", {});

    expect(out.events()[0]).toMatchObject({ scope: "leaf" });
  });

  test("do not leak their bindings back to the parent", () => {
    const out = collector();
    const log = createLogger({ sink: out.sink, now: fixedNow });

    log.child({ runId: "r1" }).info("run.step", {});
    log.info("run.step", {});

    expect(out.events()[0]).toHaveProperty("runId", "r1");
    expect(out.events()[1]).not.toHaveProperty("runId");
  });

  test("call fields win over bindings of the same name", () => {
    const out = collector();
    const log = createLogger({ sink: out.sink, now: fixedNow, bindings: { runId: "bound" } });

    log.info("run.step", { runId: "explicit" });

    expect(out.events()[0]).toMatchObject({ runId: "explicit" });
  });

  test("inherit the level threshold", () => {
    const out = collector();
    const log = createLogger({ sink: out.sink, level: "error", now: fixedNow });

    log.child({ runId: "r1" }).info("run.step", {});

    expect(out.lines).toHaveLength(0);
  });
});

describe("noopLogger", () => {
  test("writes nothing and keeps returning itself from child", () => {
    expect(noopLogger.child({ runId: "r1" })).toBe(noopLogger);
    expect(() => {
      noopLogger.info("run.step", { runId: "r1" });
    }).not.toThrow();
  });
});

describe("errorFields", () => {
  test("flattens an Error into message, name and stack", () => {
    const fields = errorFields(new TypeError("boom"));

    expect(fields).toMatchObject({ error: "boom", errorName: "TypeError" });
    expect(typeof fields["stack"]).toBe("string");
  });

  test("stringifies a thrown non-Error", () => {
    expect(errorFields("plain string")).toEqual({ error: "plain string" });
  });

  test("produces fields a log event accepts", () => {
    const result = LogEventSchema.safeParse({
      ts: FIXED_TS,
      level: "error",
      event: "run.crashed",
      ...errorFields(new Error("boom")),
    });

    expect(result.success).toBe(true);
  });
});

describe("parseLogLevel", () => {
  test.each([
    ["debug", "debug"],
    ["error", "error"],
  ])("accepts %s", (input, expected) => {
    expect(parseLogLevel(input)).toBe(expected as LogLevel);
  });

  test.each([undefined, "", "verbose"])("falls back for %p", (input) => {
    expect(parseLogLevel(input)).toBe("info");
    expect(parseLogLevel(input, "debug")).toBe("debug");
  });
});
