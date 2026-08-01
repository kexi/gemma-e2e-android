---
type: Decision
title: "Structured logs: NDJSON on stderr, validated by Zod"
description: Every runtime log line is one Zod-validated JSON object on stderr.
status: stable
tags: [logging, zod, ndjson]
sources:
  - id: logger
    resource: 056847a8ab81c7da956faf10273776a291af7feb
    title: Unify runtime output on Zod-validated NDJSON logs
---

Every runtime log line is one JSON object written to stderr. The spine is fixed
— `ts` (ISO 8601), `level` (`debug`/`info`/`warn`/`error`), and `event`, a
dot-separated namespace such as `run.step`, `adb.exec_failed`, or
`http.request` — and each event carries its own structured fields alongside it.
`@gemma-e2e/logger` owns the `LogEvent` schema and the `createLogger` factory;
`child()` binds context like `runId` so it rides on every subsequent line.

Libraries never write on their own: `packages/adb`, `packages/agent`, and the
Hono app all take a `logger` and default to a no-op, so the process entrypoint
is the single place that decides output. That is also what makes assertions on
emitted events cheap in tests, which inject a collecting sink.

*Why stderr and not stdout:* stdout belongs to a command's actual output, so
piping a result through `jq` should not swallow the logs.

*Why not pino or winston:* Zod already validates every event, which is the
property being bought, and a JSON line plus a level filter is the rest of what
these provide. *Why validation does not throw:* a bad log field is not worth
ending a run over, so an invalid event is still written, preceded by a
`log.invalid_event` warning naming the offending paths — loud in development,
harmless in production.
