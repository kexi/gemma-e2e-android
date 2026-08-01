# Architecture

The decisions that shape this project, each with why it was chosen and what was
turned down. Only the development environment exists so far; the application
code lands in later work.

日本語版: [ja/ARCHITECTURE.md](ja/ARCHITECTURE.md)

## The domain: scenarios bundle test cases

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

*Why two JVMs in one devshell:* AGP still requires JDK 17, while firebase-tools
15 refuses to start the Firestore emulator on anything older than 21. Both ship;
17 stays first on `PATH` and in `JAVA_HOME` so Gradle is untouched, and the
emulator recipes prepend `$FIREBASE_JAVA_HOME/bin` instead. It has to be `PATH`
rather than `JAVA_HOME` because firebase-tools resolves `java` from `PATH`.

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

### Per-case screen recording: `scrcpy --no-playback --record`

Every case is filmed end to end. The runner spawns one scrcpy per case just
before the app reset and, once the verdict is in, ends the device-side capture
so scrcpy finalises `var/videos/{runId}/{caseId}.mp4` and exits. The path lands
on the `CaseRun` and the dashboard plays it back inside the finished case's
accordion. `RECORD_RUNS=0` turns the whole thing off.

*Why one file per case rather than per run:* a case is the unit that gets a
verdict, so "watch the case that failed" should not mean scrubbing through the
ones that passed. It also matches how screenshots are already filed.

*Why not `adb shell screenrecord`:* it stops at three minutes, and a case with a
20-step budget against a local model routinely runs longer. Its output would
also have to be pulled off the device afterwards.

*Why not `adb emu screenrecord`:* emulator only, so physical devices would need
a second implementation of the same feature. scrcpy pulls the device's H.264
stream over adb and muxes it on the host, which covers both with one code path
and no duration cap.

*Why `--no-playback`:* the recording is the artifact; a mirroring window would
demand a display, which a headless CI machine does not have. The dashboard's
live view is a separate path (gRPC frames) and is unaffected.

*Why stopping means `adb shell pkill` on the device, not a signal to scrcpy:*
this was found the hard way. scrcpy 4.1 routes its interrupt handling through
SDL's event loop, which under `--no-playback` from a server process never runs —
so it ignores both `SIGINT` and `SIGTERM` outright. The obvious implementation
(send `SIGINT`, fall back to `SIGKILL` on a timeout) therefore produced files
with no `moov` atom every single time: `ffprobe` reports "moov atom not found"
and no player will open them. Ending the device-side capture instead reaches
scrcpy through the one path it does watch — the video stream closes, it writes
the index and exits by itself. `stop()` awaits that exit, so the file is
complete before the path is handed to anyone. The `SIGKILL` timeout survives
only to stop a wedged scrcpy holding the device, and it reports the recording as
failed rather than returning a path to an unplayable file.

*Why the first moment of each case can be missing:* scrcpy needs a beat to
negotiate its video socket, and polling for the first frame would add that delay
to every case. What is lost is the app-reset screen, which no verdict depends on.

*Why recording is best effort:* scrcpy that is absent, or a device that refuses
the encoder, warns `record.failed` and leaves `videoPath` null rather than
failing the case. The verdict comes from the step log; the video is a debugging
aid, exactly like the screenshots. A case that *errored* still keeps its
recording, since that is the one most worth watching.

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

### Run history: Firestore plus files

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

### A generic Zod converter, validating in both directions

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

### SSE stays; Firestore listeners are a later option

The dashboard still follows a run over server-sent events published by the
in-process `RunEventBus`, with Firestore used purely for persistence. Events now
carry a `caseId` so the client can file each step under the right case.

*Why not point the browser at Firestore's own realtime listeners:* that would
mean shipping Firebase credentials to the client and opening security rules that
are currently deny-all, in exchange for removing a bus that is a few dozen lines.
Worth revisiting if the dashboard ever needs to follow runs started by a
different process — which is exactly what the move to Firestore makes possible.

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
