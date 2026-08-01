# Architecture

How this project is put together: the domain it models, the loop it runs, and
where each decision is written down.

Every decision — what was chosen, why, and what was turned down — lives as one
file under [knowledge/](knowledge/index.md), in
[Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf)
v0.2. This page keeps the overview and the diagrams; it deliberately does not
restate the reasoning, so there is only ever one copy to keep current.

日本語版: [ja/ARCHITECTURE.md](ja/ARCHITECTURE.md)

## The domain: scenarios bundle test cases

A **test case** is one natural-language goal that earns one verdict. A
**scenario** is a bundle of cases that share an app and, usually, a model.

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

Why cases are the unit that earns a verdict, why they run sequentially, and how
`case.model ?? scenario.model ?? LLM_MODEL` resolves:
[knowledge/scenarios-bundle-cases.md](knowledge/scenarios-bundle-cases.md).

## The E2E loop

Each case runs a perceive → decide → act → judge loop until its goal is met or
its step budget is exhausted.

```
                  ┌──────────────────────────────────────────┐
                  │                                          │
   ┌──────────────▼───────────────┐                          │
   │ Android device / emulator    │                          │
   └──────────────┬───────────────┘                          │
                  │ adb shell uiautomator dump               │
                  ▼                                          │
   ┌──────────────────────────────┐                          │
   │ UI tree (XML → compact text) │                          │
   └──────────────┬───────────────┘                          │
                  │ prompt: goal + UI tree + step history    │
                  ▼                                          │
   ┌──────────────────────────────┐                          │
   │ Gemma 4 via LM Studio        │                          │
   │ (Genkit + Zod structured out)│                          │
   └──────────────┬───────────────┘                          │
                  │ {action: tap|type|swipe|back|assert, …}  │
                  ▼                                          │
   ┌──────────────────────────────┐   adb input / shell      │
   │ Action executor              │──────────────────────────┘
   └──────────────┬───────────────┘
                  │ step log + screenshot path + verdict
                  ▼
   ┌──────────────────────────────┐      ┌────────────────────┐
   │ Firestore run history        │◄─────┤ Hono server + SSE  │
   │ runs/{id}/cases/{id}/steps   │      └─────────┬──────────┘
   └──────────────────────────────┘                │
                                         ┌─────────▼──────────┐
                                         │ Web dashboard      │
                                         │ (Vite + React+ MUI)│
                                         └────────────────────┘

   Live view (separate path, same server):

   ┌──────────────────┐  gRPC streamScreenshot  ┌────────────────────┐
   │ Emulator -grpc   │────────────────────────►│ Hono frame relay   │
   └──────────────────┘        (PNG frames)     └─────────┬──────────┘
                                                          │ WebSocket
                                                ┌─────────▼──────────┐
                                                │ Workbench main pane│
                                                └────────────────────┘
```

## Repository layout

```
apps/example    Kexi Coffee Shop — the Expo app under test
apps/web        Vite + React dashboard
packages/*      agent core, adb wrapper, LLM client (buildless TS)
```

## Decisions

One file each, under [knowledge/](knowledge/index.md).

### Domain

| Decision | Concept |
| --- | --- |
| The domain: scenarios bundle test cases | [scenarios-bundle-cases.md](knowledge/scenarios-bundle-cases.md) |
| Scenarios: files plus ad-hoc runs | [scenarios-files-and-ad-hoc.md](knowledge/scenarios-files-and-ad-hoc.md) |

### Agent loop

| Decision | Concept |
| --- | --- |
| UI capture: `adb shell uiautomator dump` | [ui-capture-uiautomator-dump.md](knowledge/ui-capture-uiautomator-dump.md) |
| Model input: UI tree text only | [model-input-ui-tree-text.md](knowledge/model-input-ui-tree-text.md) |
| LM Studio + Gemma 4, called through Genkit with Zod | [lm-studio-genkit-zod.md](knowledge/lm-studio-genkit-zod.md) |

### Storage

| Decision | Concept |
| --- | --- |
| Run history: Firestore plus files | [run-history-firestore.md](knowledge/run-history-firestore.md) |
| A generic Zod converter, validating in both directions | [zod-firestore-converter.md](knowledge/zod-firestore-converter.md) |

### Dashboard

| Decision | Concept |
| --- | --- |
| Web dashboard: Vite + React + Hono + MUI | [web-dashboard-stack.md](knowledge/web-dashboard-stack.md) |
| SSE stays; Firestore listeners are a later option | [sse-over-firestore-listeners.md](knowledge/sse-over-firestore-listeners.md) |
| Live device view: gRPC `streamScreenshot` over a WebSocket | [live-device-view.md](knowledge/live-device-view.md) |
| Per-case screen recording: `scrcpy --no-playback --record` | [per-case-screen-recording.md](knowledge/per-case-screen-recording.md) |
| Browser target: latest Chrome, Baseline Newly available, no polyfills | [latest-chrome-baseline-newly.md](knowledge/latest-chrome-baseline-newly.md) |

### Platform and tooling

| Decision | Concept |
| --- | --- |
| Expo with prebuild (CNG) | [expo-prebuild-cng.md](knowledge/expo-prebuild-cng.md) |
| Bun everywhere: package manager, runtime, test runner | [bun-everywhere.md](knowledge/bun-everywhere.md) |
| TypeScript strict, buildless packages | [typescript-strict-buildless.md](knowledge/typescript-strict-buildless.md) |
| oxlint and oxfmt | [oxlint-oxfmt.md](knowledge/oxlint-oxfmt.md) |
| Structured logs: NDJSON on stderr, validated by Zod | [structured-logs-ndjson.md](knowledge/structured-logs-ndjson.md) |
| Supply-chain minimum release age, in three layers | [supply-chain-release-age.md](knowledge/supply-chain-release-age.md) |
| Tooling and process | [tooling-and-process.md](knowledge/tooling-and-process.md) |
