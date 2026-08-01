import { z } from "zod";

export const LogLevelSchema = z.enum(["debug", "info", "warn", "error"]);
export type LogLevel = z.infer<typeof LogLevelSchema>;

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/**
 * Dot-separated namespace, lowest-cardinality part first: `run.step`,
 * `adb.exec`, `http.request`. Grepping a prefix therefore selects a subsystem.
 */
export const LogEventNameSchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9_]*)+$/,
    "event must be dot-separated lowercase segments",
  );

/**
 * A JSON value, so a line always survives `JSON.stringify` -> `JSON.parse`
 * unchanged. `undefined` is accepted at the edge and dropped before writing:
 * `exactOptionalPropertyTypes` callers pass `foo: maybe` constantly, and
 * rejecting that would push a filter into every call site.
 */
export type LogValue = string | number | boolean | null | LogValue[] | { [key: string]: LogValue };

export const LogValueSchema: z.ZodType<LogValue> = z.lazy(() =>
  z.union([
    z.string(),
    // Rejects NaN and +/-Infinity, which JSON.stringify silently turns into
    // null -- a field that reads as "absent" downstream rather than "broken".
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(LogValueSchema),
    z.record(LogValueSchema),
  ]),
);

/** Structured fields accompanying an event; `undefined` entries are dropped. */
export type LogFields = Record<string, LogValue | undefined>;

/**
 * One NDJSON line. `ts`/`level`/`event` are the fixed spine every consumer can
 * rely on; everything else is event-specific and validated as JSON-safe.
 */
export const LogEventSchema = z
  .object({
    ts: z.string().datetime({ offset: true }),
    level: LogLevelSchema,
    event: LogEventNameSchema,
  })
  .catchall(LogValueSchema);

/**
 * Stated as an intersection rather than taken from `z.infer`: the inferred type
 * of a `.catchall()` object widens `ts`/`level`/`event` to the catchall's type
 * as well, which loses the literal union on `level` and stops a consumer from
 * narrowing on it. Spelling the spine out keeps those exact while still
 * admitting arbitrary JSON-safe fields.
 */
export type LogEvent = {
  ts: string;
  level: LogLevel;
  event: string;
} & Record<string, LogValue>;

/** Where a logger writes finished lines. Tests swap in a collector. */
export type LogSink = (line: string) => void;

export interface LoggerOptions {
  /** Context merged into every event; `child()` extends it. */
  bindings?: LogFields | undefined;
  level?: LogLevel | undefined;
  sink?: LogSink | undefined;
  now?: (() => Date) | undefined;
}

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  child(bindings: LogFields): Logger;
}

/**
 * stderr, not stdout: stdout is where a CLI's actual output belongs, and
 * keeping the two apart means piping a command's result through `jq` does not
 * also swallow its logs.
 */
export const stderrSink: LogSink = (line) => {
  process.stderr.write(`${line}\n`);
};

/** Discards everything; the default for libraries, so importing one is silent. */
export const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => noopLogger,
};

const DEFAULT_LEVEL: LogLevel = "info";

function stripUndefined(fields: LogFields): Record<string, LogValue> {
  const out: Record<string, LogValue> = {};
  for (const [key, value] of Object.entries(fields)) {
    const isAbsent = value === undefined;
    if (isAbsent) {
      continue;
    }
    out[key] = value;
  }
  return out;
}

/**
 * Flattens an Error into log fields. Errors are the one non-JSON value that
 * turns up in nearly every catch block, and `JSON.stringify(err)` yields `{}`.
 */
export function errorFields(error: unknown): LogFields {
  const isError = error instanceof Error;
  if (!isError) {
    return { error: String(error) };
  }

  return {
    error: error.message,
    errorName: error.name,
    ...(error.stack === undefined ? {} : { stack: error.stack }),
  };
}

/**
 * Creates a logger that writes one JSON object per line.
 *
 * Every event is validated against LogEventSchema before it is written. Why not
 * throw on a bad event: a log call is not the operation the caller cares about,
 * and taking down a run because a field was NaN trades a cosmetic defect for an
 * outage. Invalid events are still emitted, preceded by a `log.invalid_event`
 * warning naming the offending paths, so the mistake is loud in development
 * without being fatal in production.
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  const bindings = options.bindings ?? {};
  const level = options.level ?? DEFAULT_LEVEL;
  const sink = options.sink ?? stderrSink;
  const now = options.now ?? (() => new Date());
  const threshold = LEVEL_ORDER[level];

  function write(eventLevel: LogLevel, event: string, fields: LogFields | undefined): void {
    const isBelowThreshold = LEVEL_ORDER[eventLevel] < threshold;
    if (isBelowThreshold) {
      return;
    }

    // Spine first so it leads every line -- a truncated log is still readable
    // when ts/level/event survive. Restated afterwards because a stray `level`
    // among the fields would otherwise produce a line that lies about its own
    // severity; re-assigning keeps the value right without moving the key.
    const spine = { ts: now().toISOString(), level: eventLevel, event };
    const record: LogEvent = {
      ...spine,
      ...stripUndefined(bindings),
      ...stripUndefined(fields ?? {}),
      ...spine,
    };

    const parsed = LogEventSchema.safeParse(record);
    if (!parsed.success) {
      const paths = parsed.error.issues.map((issue) => issue.path.join(".") || "<root>").join(", ");
      sink(
        JSON.stringify({
          ts: record.ts,
          level: "warn",
          event: "log.invalid_event",
          invalidEvent: event,
          invalidPaths: paths,
        }),
      );
    }

    sink(JSON.stringify(record));
  }

  const logger: Logger = {
    debug: (event, fields) => {
      write("debug", event, fields);
    },
    info: (event, fields) => {
      write("info", event, fields);
    },
    warn: (event, fields) => {
      write("warn", event, fields);
    },
    error: (event, fields) => {
      write("error", event, fields);
    },
    child: (extra) =>
      createLogger({
        ...options,
        bindings: { ...bindings, ...extra },
      }),
  };

  return logger;
}

/** Reads a level from an env var, falling back when it is unset or bogus. */
export function parseLogLevel(
  value: string | undefined,
  fallback: LogLevel = DEFAULT_LEVEL,
): LogLevel {
  const parsed = LogLevelSchema.safeParse(value);
  return parsed.success ? parsed.data : fallback;
}
