---
type: Decision
title: "Run history: Firestore plus files"
description: Step logs and verdicts live in Firestore; screenshots and recordings stay on disk.
status: stable
tags: [firestore, storage, history]
sources:
  - id: firestore
    resource: 1b7eb616f74a32eab55cc6f464bce14e3f83666e
    title: Model scenarios as bundles of cases, and persist runs in Firestore
  - id: sqlite-original
    resource: 9a605b48b22b69e5e465e86bb4aeca2b1e1aecc4
    title: Implement core, adb, agent, and store packages
  - id: recording
    resource: b9a357ce01eed01b4e792a5ffe3341ed65012b51
    title: Record each test case to video so failures can be replayed
---

Step logs and verdicts go in Firestore, mirroring the domain as a document
hierarchy — `runs/{runId}` → `cases/{caseId}` → `steps/{index}`. Screenshots and
per-case screen recordings stay on disk with their paths stored in the
documents. Development and CI run
against the Firestore emulator on port 8790 under the project id
`demo-gemma-e2e`; the `demo-` prefix is what makes firebase-tools work fully
offline, never contacting Google.

Nesting matches the domain, so reading one case's timeline is one query on one
subcollection rather than a filter over a flat table. Step documents are named
by zero-padded index (`000007`) so Firestore's lexicographic document order is
also step order, with no `orderBy` field to keep in sync.

*Why not SQLite (which this replaced):* a single local file cannot be shared
between machines or a future hosted dashboard, and its history would stay
trapped on whichever laptop ran the tests. Firestore keeps the same
zero-configuration local development story through the emulator while leaving
the door open to a shared deployment — nothing in the store code changes, only
`FIRESTORE_EMULATOR_HOST` going away.

*Why not blobs in the DB:* Firestore documents cap at 1 MiB and charge by read;
a screenshot would blow the budget on both counts.
