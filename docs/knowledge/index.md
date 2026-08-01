---
okf_version: "0.2"
---

# Decisions

Every technical decision in this project, one file each, in
[Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf)
v0.2. Each concept states what was chosen, why, and what was turned down.

The overview and data-flow diagrams live in
[../ARCHITECTURE.md](../ARCHITECTURE.md), which links back to every concept here.

日本語版: [../ja/knowledge/index.md](../ja/knowledge/index.md)

## Domain

- [scenarios-bundle-cases.md](scenarios-bundle-cases.md) — The domain: scenarios bundle test cases
- [scenarios-files-and-ad-hoc.md](scenarios-files-and-ad-hoc.md) — Scenarios: files plus ad-hoc runs

## Agent loop

- [ui-capture-uiautomator-dump.md](ui-capture-uiautomator-dump.md) — UI capture: `adb shell uiautomator dump`
- [model-input-ui-tree-text.md](model-input-ui-tree-text.md) — Model input: UI tree text only
- [lm-studio-genkit-zod.md](lm-studio-genkit-zod.md) — LM Studio + Gemma 4, called through Genkit with Zod

## Storage

- [run-history-firestore.md](run-history-firestore.md) — Run history: Firestore plus files
- [zod-firestore-converter.md](zod-firestore-converter.md) — A generic Zod converter, validating in both directions

## Dashboard

- [web-dashboard-stack.md](web-dashboard-stack.md) — Web dashboard: Vite + React + Hono + MUI
- [sse-over-firestore-listeners.md](sse-over-firestore-listeners.md) — SSE stays; Firestore listeners are a later option
- [live-device-view.md](live-device-view.md) — Live device view: gRPC `streamScreenshot` relayed over a WebSocket
- [per-case-screen-recording.md](per-case-screen-recording.md) — Per-case screen recording: `scrcpy --no-playback --record`
- [latest-chrome-baseline-newly.md](latest-chrome-baseline-newly.md) — Browser target: latest Chrome, Baseline Newly available, no polyfills

## Platform and tooling

- [expo-prebuild-cng.md](expo-prebuild-cng.md) — Expo with prebuild (CNG)
- [bun-everywhere.md](bun-everywhere.md) — Bun everywhere: package manager, runtime, test runner
- [typescript-strict-buildless.md](typescript-strict-buildless.md) — TypeScript strict, buildless packages
- [oxlint-oxfmt.md](oxlint-oxfmt.md) — oxlint and oxfmt
- [structured-logs-ndjson.md](structured-logs-ndjson.md) — Structured logs: NDJSON on stderr, validated by Zod
- [supply-chain-release-age.md](supply-chain-release-age.md) — Supply-chain minimum release age, in three layers
- [tooling-and-process.md](tooling-and-process.md) — Tooling and process
