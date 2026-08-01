# Architecture

The decisions that shape this project, each with why it was chosen and what was
turned down. Only the development environment exists so far; the application
code lands in later work.

日本語版: [ja/ARCHITECTURE.md](ja/ARCHITECTURE.md)

## The E2E loop

A test is a natural-language goal ("check that the user can log in"). The agent
runs a perceive → decide → act → judge loop until the goal is met or a step
budget is exhausted.

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
   │ SQLite run history           │◄─────┤ Hono server + SSE  │
   └──────────────────────────────┘      └─────────┬──────────┘
                                                   │
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
                                                │ Device / Run page  │
                                                └────────────────────┘
```

## Planned repository layout

```
apps/example    Expo app under test
apps/web        Vite + React dashboard
packages/*      agent core, adb wrapper, LLM client (buildless TS)
```

## Decisions

### Expo with prebuild (CNG)

Continuous Native Generation regenerates `android/` and `ios/` from app config,
so the native projects stay disposable and are gitignored. This is what forces
the Android SDK and Azul Zulu JDK 17 (the JDK Expo recommends) into the
devshell — a managed-workflow-only setup would not need them.

*Why `zulu17` and not `jdk17`:* nixpkgs' `jdk17` already resolves to Zulu on
darwin but to plain OpenJDK on Linux. Naming `zulu17` outright states the
intent and keeps every platform on the same JVM.

*Why not Expo Go:* the agent needs a real dev build to exercise native modules
and realistic UI, and Go cannot host custom native code.

### Bun everywhere: package manager, runtime, test runner

One tool for installs, TypeScript execution, and `bun test`. Bun runs TS
natively, which is what makes the buildless `packages/*` layout viable.
Workspaces come from Bun's `workspaces` field.

*Why not pnpm + Node + Vitest:* three tools with three configs to keep in sync;
Bun collapses them. *Risk accepted:* Genkit does not officially support Bun.
Node 22 stays in the devshell as the escape hatch — if Genkit misbehaves, the
agent alone runs on Node.

### Supply-chain minimum release age, in three layers

Nothing published in the last 24 hours enters the tree, so a compromised
release has a window to be caught and yanked before it reaches a lockfile.

| Layer | Mechanism |
| --- | --- |
| npm packages | `bunfig.toml` → `minimumReleaseAge = 86400` (seconds) |
| GitHub Actions | `just pin` → `pinact run --min-age 1` (days) |
| Update PRs | `renovate.json` → `minimumReleaseAge: "1 day"` |

Actions are additionally pinned to 40-char SHAs by pinact, with the tag kept as
a trailing comment. Renovate's `helpers:pinGitHubActionDigests` follows those
pins on update.

*Why not trust tags:* a mutable tag can be repointed at malicious code after
review.

### TypeScript strict, buildless packages

`tsconfig.base.json` turns on `strict`, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, and friends; every app and package extends it.
`packages/*` ship TS sources consumed directly across the workspace.

*Why not a bundler now:* a build step buys nothing when the only consumer is
Bun in the same repo. Add [tsdown](https://tsdown.dev/) when publishing to npm
or producing a single file becomes a requirement.

### oxlint and oxfmt

Rust-based, natively aware of TS/TSX, and fast enough to run in a pre-commit
hook on staged files. They live in `devDependencies` rather than the devshell so
their versions are managed alongside the rest of the JS toolchain, which the
Expo ecosystem expects.

*Why not ESLint + Prettier:* slower, and a much larger plugin surface to audit.
*Caveat:* oxfmt is pre-1.0; if it proves unstable the `fmt` tasks can be pulled
out without touching anything else.

### Web dashboard: Vite + React + Hono + MUI

The runner is operated from a browser from day one — submitting prompts,
watching steps stream in, viewing screenshots. Hono co-locates with the agent
process and pushes progress over SSE/WebSocket. MUI plus MUI Icons covers dense,
data-heavy screens without bespoke design work.

*Why not a CLI first:* step logs and screenshots are the primary debugging
artifact, and a terminal renders neither well.

### Live device view: gRPC `streamScreenshot` relayed over a WebSocket

The dashboard shows the emulator screen live — on its own Device page, and
beside the step timeline while a run is in progress. The Hono server dials the
emulator's gRPC bridge (`emulator -grpc 8554`), calls the `EmulatorController`
service's server-streaming `streamScreenshot`, and forwards each PNG to the
browser as a binary WebSocket frame; the client renders it through an object
URL. `apps/web/server/proto/emulator_controller.proto` is vendored from the
emulator's own `lib/` directory, and `@grpc/proto-loader` reads it at runtime,
so no codegen step enters the otherwise buildless workspace.

*Why not WebRTC via `android-emulator-webrtc`:* that is Google's own React
component and was the first choice, but it cannot work against a desktop
emulator. Its current release (2.0.1) talks REST plus WebSocket JSEP to an
"Emulator Gateway", and the gateway's job is to relay JSEP into the emulator's
`Rtc` gRPC service. That service does not exist in this build: emulator 37.2.2
for darwin-aarch64 ships no `rtc_service.proto`, and the only
`android.emulation.control.*` services registered in the binary are
`EmulatorController`, `SnapshotService`, `UiController`, and `Adb` — no `Rtc`,
and no `requestRtcStream`/`sendJsepMessage` symbols anywhere. The RTC service
is built only into Google's Linux container `emulator-webrtc` images. The older
1.0.18 release does not help either: its PNG fallback issues `getScreenshot`
over grpc-web, which the bridge also does not speak, so it would still need an
Envoy or grpcwebproxy hop. Relaying `streamScreenshot` ourselves reaches the
same screen with one process fewer and no proxy at all.

*What is given up:* no audio, no input forwarding, and frame-rate rather than
video-codec efficiency. None of it is missed — the view exists to watch the
agent work, and the agent acts through adb.

*Why frames feel "stuck":* `streamScreenshot` emits only when the screen
changes, so an idle device legitimately produces no frames. The relay caps
delivery at ~20 fps so an animation cannot flood the socket.

*Why insecure gRPC:* the bridge binds to localhost and is started without
`-grpc-use-token`, so there is no credential to present. Nothing else in the
repo depends on the flag; dropping it costs only the live view.

### LM Studio + Gemma 4, called through Genkit with Zod

The model runs locally on the MLX engine (`gemma-4-12b`, or E4B when memory is
tight). Genkit's OpenAI-compatible plugin points at `http://localhost:1234/v1`,
and every decision comes back as a Zod-validated structured output.

*Why not native tool calls:* the tool-call parsers in MLX-family Gemma 4 builds
are unreliable; structured output sidesteps them entirely. Genkit also gives a
Dev UI trace per decision ("why did it tap that?") and a path to `genkit eval`
for regression-testing judgment quality later. LM Studio is a GUI app, so it is
installed manually rather than through Nix.

### UI capture: `adb shell uiautomator dump`

No extra app, no instrumentation server, no code on the device — just XML from
a shell command.

*Why not Appium UiAutomator2 or a custom Accessibility Service:* both are
faster but add a server to install, launch, and keep in sync. Revisit if dump
latency becomes the bottleneck.

### Model input: UI tree text only

Screenshots are captured, stored, and shown in the dashboard, but not sent to
the model. Text-only prompts are smaller and faster, and the UI tree already
carries the resource IDs and accessibility labels needed to act.

*Why not vision:* Gemma 4 accepts images, and that can be enabled if accuracy
demands it — at a real cost in tokens and latency.

### Run history: SQLite plus files

Step logs and verdicts go in SQLite (queryable, single file, zero setup);
screenshots go on disk with paths stored in the database.

*Why not blobs in the DB:* large binaries bloat the file and slow every query
that does not need them.

### Structured logs: NDJSON on stderr, validated by Zod

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

### Scenarios: files plus ad-hoc runs

Test scenarios live in the repo as YAML/Markdown so they can be reviewed,
versioned, and replayed in CI. The dashboard can also run one-off prompts that
were never committed.

### Tooling and process

- **Nix flake + direnv** — the SDK, Zulu JDK, Bun, and every CLI are pinned by
  `flake.lock`, so "works on my machine" means "works on yours". Android SDK
  comes from [android-nixpkgs](https://github.com/tadfisher/android-nixpkgs),
  keeping Android Studio out of the loop; `adb` is the SDK's copy only, never
  also nixpkgs' `android-tools`.
- **just** — a thin, discoverable task list (`just --list`) instead of a wall of
  npm scripts.
- **lefthook + gitleaks** — secrets are blocked at commit time, when the fix is
  cheap; rotating a pushed key is not.
- **Renovate** — dependency updates arrive as PRs that respect the same
  release-age policy as local installs.
- **English source, Japanese alongside** — docs and comments are written in
  English with translations under `docs/ja/`.
- **MIT license.**
