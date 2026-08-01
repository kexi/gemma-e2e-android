---
type: Decision
title: "Scenarios: files plus ad-hoc runs"
description: Committed YAML scenarios, with one-off prompts modelled as a scenario of one case.
status: stable
tags: [scenarios, yaml, dashboard]
sources:
  - id: dashboard
    resource: e0ca7be5d719ac7fbd82869150877868fcbe7dce
    title: Add the web dashboard so runs are driven and read from a browser
  - id: cases
    resource: 1b7eb616f74a32eab55cc6f464bce14e3f83666e
    title: Model scenarios as bundles of cases, and persist runs in Firestore
---

Test scenarios live in the repo as YAML so they can be reviewed, versioned, and
replayed in CI. The dashboard can also run one-off prompts that were never
committed, optionally against a model picked from a dropdown that
`GET /api/models` fills from the LLM endpoint's `/v1/models`.

*Why the model list is proxied through the server:* LM Studio sends no CORS
headers, so the browser cannot call it directly. Embedding models are filtered
out of the listing by id, since one cannot produce a decision and choosing it
would only yield a failed run.

An ad-hoc prompt becomes a scenario of exactly one case, so the runner has a
single shape to execute and the resulting history looks the same whether it came
from a file or the form.

*Why the dashboard's scenario builder still writes a file:* `POST /api/scenarios`
validates its body with the same Zod schema the YAML loader uses and writes
`scenarios/<id>.yaml`. The UI is an entry point to the directory, not a second
store — a scenario built in the browser is reviewed, versioned and replayed in CI
exactly like a hand-written one. An id that is already on disk is answered with
409 rather than overwritten, because these files are git-managed and a silent
replacement would destroy reviewed work.
