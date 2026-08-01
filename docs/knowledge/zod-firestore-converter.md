---
type: Decision
title: A generic Zod converter, validating in both directions
description: One converter turns any Zod schema into a FirestoreDataConverter that parses on write as well as read.
status: stable
tags: [firestore, zod, validation]
sources:
  - id: firestore
    resource: 1b7eb616f74a32eab55cc6f464bce14e3f83666e
    title: Model scenarios as bundles of cases, and persist runs in Firestore
---

`zodConverter(schema, label)` in `packages/store` turns any Zod schema into a
Firestore `FirestoreDataConverter`, and every collection goes through one.
Crucially it parses on **write** as well as on read.

*Why validate on write:* Firestore is schemaless, so a field the type system
believes exists is only actually guaranteed by a runtime check. Rejecting a
malformed document at write time is what lets the read side treat a validation
failure as genuine corruption rather than a routine occurrence. Zod's output is
what gets stored, so unknown keys are stripped and defaults applied — the
document on disk matches the schema exactly.

Documents omit the fields their own path already encodes (`runId`, `caseId`,
`index`); the reader restores them from the document id. *Why not store them
twice:* two copies of the same fact can disagree.

*Why timestamps stay ISO 8601 strings and not Firestore `Timestamp`:* every
consumer — the JSON API, the SSE payloads, the dashboard — already speaks ISO
strings, so a `Timestamp` would need converting at each boundary while gaining
nothing. The queries this store runs order by document id or by a string field,
and ISO 8601 sorts correctly either way.
