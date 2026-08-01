---
type: Decision
title: "The domain: scenarios bundle test cases"
description: A case is what earns a verdict; a scenario only groups and orders cases.
status: stable
tags: [domain, scenarios, cases, model-resolution]
sources:
  - id: cases
    resource: 1b7eb616f74a32eab55cc6f464bce14e3f83666e
    title: Model scenarios as bundles of cases, and persist runs in Firestore
---

A **test case** is one natural-language goal that earns one verdict ("check that
a wrong password shows an error"). A **scenario** is a bundle of cases that
share an app and, usually, a model. Cases are what get verdicts; the scenario
only groups and orders them.

```
   Scenario (scenarios/login.yaml)
   ├─ id, title, app?, model?
   └─ cases: TestCase[]            (at least one, run in order)
      ├─ TestCase { id (slug), title?, prompt, model?, maxSteps=20 }
      └─ TestCase { … }

   One execution of a scenario:

   Run  { id, scenarioId, title, status, verdictReason, startedAt, finishedAt }
   └─ CaseRun { caseId, order, title, prompt, model, status, verdictReason,
      │          videoPath, … }
      └─ Step { index, action, uiText, screenshotPath, note, createdAt }
```

**Model resolution** is `case.model ?? scenario.model ?? LLM_MODEL`, computed by
`resolveModel` in `packages/core` and stored on the `CaseRun`, so history records
the model that actually ran rather than the one configured later.

*Why per-case models:* a cheap model is enough to drive an obvious happy path,
while a harder assertion may need a larger one. Fixing the model per run would
force the whole bundle onto the slowest choice.

*Why cases run sequentially:* they share one device, so two cases driving the
same screen would interleave taps. Each case force-stops and relaunches the app
first, because `am start` on a live process resumes whatever screen the previous
case left behind — a case would otherwise inherit the last one's navigation
stack and login session.

*Why one failure does not stop the rest:* the point of bundling cases is to
learn about all of them from one run. A run is `passed` only when every case is.
