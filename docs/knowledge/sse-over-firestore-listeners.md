---
type: Decision
title: SSE stays; Firestore listeners are a later option
description: The dashboard follows runs over an in-process event bus, with Firestore used purely for persistence.
status: stable
tags: [sse, firestore, dashboard]
sources:
  - id: dashboard
    resource: e0ca7be5d719ac7fbd82869150877868fcbe7dce
    title: Add the web dashboard so runs are driven and read from a browser
  - id: firestore
    resource: 1b7eb616f74a32eab55cc6f464bce14e3f83666e
    title: Model scenarios as bundles of cases, and persist runs in Firestore
---

The dashboard still follows a run over server-sent events published by the
in-process `RunEventBus`, with Firestore used purely for persistence. Events now
carry a `caseId` so the client can file each step under the right case.

*Why not point the browser at Firestore's own realtime listeners:* that would
mean shipping Firebase credentials to the client and opening security rules that
are currently deny-all, in exchange for removing a bus that is a few dozen lines.
Worth revisiting if the dashboard ever needs to follow runs started by a
different process — which is exactly what the move to Firestore makes possible.
