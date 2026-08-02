# gemma-e2e-android

Run end-to-end tests from natural-language prompts, on an Android device or in
Chrome. You write something like *"check that the user can log in"*; an agent
driven by a local [Gemma](https://ai.google.dev/gemma) model reads the live UI
tree, decides the next tap or type, performs it, and judges whether the goal was
met. Everything runs on your machine — the LLM is served locally by LM Studio,
so no screenshots or app data leave it.

Each test case names its own target, so one scenario can cover both platforms
and the prompts stay the same on either.

## How it works

```
              ┌── adb uiautomator dump ──┐
scenario ─▶   │                          ├─▶ UI tree (text)
prompt        └── CDP DOM walk ──────────┘         │
                     ▲                      Gemma 4 (LM Studio)
                     │                             │
              tap / type / scroll ◀── structured Action
                     │
                     ▼
     Firestore history + screenshots + video ─▶ dashboard (live via SSE)
```

Both platforms produce the same `UiNode` tree, so the serializer the model
reads, the action vocabulary it answers in, and the prompt behind it are one
implementation rather than two.

## Repository layout

| Path | What it is |
| --- | --- |
| `packages/core` | Shared Zod schemas (UI tree, actions, runs) and the YAML scenario loader |
| `packages/adb` | adb wrapper: UI dump parsing and input commands |
| `packages/cdp` | Chrome DevTools Protocol client: page reading, input, screencast |
| `packages/agent` | Genkit-based decision loop, and the drivers that adapt each platform to it |
| `packages/store` | Run/step history in Firestore (local emulator via `firebase-admin`) |
| `apps/web` | Dashboard: Hono API + SSE, Vite/React/MUI frontend |
| `apps/cli` | `gemma-e2e` command-line client for the dashboard API |
| `apps/example-shared` | "Kexi Coffee Shop" domain data, so the two fixture apps cannot disagree |
| `apps/example-android` | The Expo build of the shop, driven over adb |
| `apps/example-web` | The browser build of the shop, driven over CDP |
| `scenarios/` | Test scenarios (`*.yaml`) — natural-language goals, each naming an Android or web target |
| `e2e/scenarios/` | CLI test scenarios (`*.yaml`) — [pitty](https://github.com/kexi/pitty) cases that drive the `gemma-e2e` binary itself |

The two scenario directories are unrelated despite the similar names.
`scenarios/` is *input to the product*: prompts Gemma executes against the
emulator or the browser. `e2e/scenarios/` is *test code for the CLI*: PTY
sessions asserting what `gemma-e2e` prints and which exit code it returns.

## Quick start

```sh
direnv allow      # devshell: every CLI tool, the Android SDK, and the emulator
just install      # JavaScript dependencies
just llm          # start LM Studio's local API (manual app install required)
just web          # dashboard → http://localhost:5173
```

Then bring up whichever platform a scenario targets:

```sh
# Android (scenarios/login.yaml, shop.yaml)
just emu          # boot the emulator          (first time: just avd-create)
just android      # build & install the example app

# Web (scenarios/login.web.yaml, shop.web.yaml)
just example-web  # the shop, in the browser → http://localhost:5174
just chrome       # Chrome with the DevTools port the driver connects to
```

`just --list` shows every task; `just check` runs the same gates as CI.
Full onboarding, including Nix/direnv and LM Studio setup: [SETUP.md](SETUP.md).

## CLI

`gemma-e2e` drives the same API the dashboard uses, so scenarios and runs can be
managed from a terminal or a CI job. It needs the dashboard running (`just web`).

```sh
just cli          # compile ./apps/cli/dist/gemma-e2e for this machine
just cli-dist     # cross-compile for macOS, Linux, and Windows
```

```sh
gemma-e2e scenario list                  # every scenario the server knows
gemma-e2e scenario get login             # one scenario and its cases
gemma-e2e scenario apply scenarios/*.yaml  # create or update from YAML
gemma-e2e scenario delete login

gemma-e2e run start login --watch        # run a scenario, follow it, exit with its verdict
gemma-e2e run start --prompt "buy a coffee" --title Coffee
gemma-e2e run list                       # the most recent runs
gemma-e2e run get <runId>                # one run, its cases and steps
gemma-e2e run watch <runId>              # follow a run already in flight

gemma-e2e models                         # models the LLM endpoint serves
gemma-e2e device                         # emulator status
```

The server is taken from `--server`, then `GEMMA_E2E_SERVER`, then
`http://127.0.0.1:5175`. `--json` prints raw API responses (`run watch` emits
one JSON document per line), and colour turns off under `NO_COLOR`, `--no-color`,
or a non-TTY stdout.

Exit status makes the CLI usable as a CI gate directly:

| Code | Meaning |
| --- | --- |
| 0 | the command succeeded, or the run passed |
| 1 | the run failed |
| 2 | the command could not be carried out (bad usage, unreachable server, errored run) |

```sh
gemma-e2e run start checkout --watch || exit $?
```

Cross-compilation covers macOS (arm64/x64), Linux (x64/arm64), and Windows
(x64). musl targets such as Alpine are not built yet.

### CLI end-to-end tests

[pitty](https://github.com/kexi/pitty) runs the compiled binary on a real PTY
and asserts its output, exit codes, and argument handling. It ships with the
devshell, so no separate install is needed.

```sh
just cli-e2e                # compiles the binary, then runs e2e/scenarios/
just cli-e2e-server         # needs `just web` up
just cli-e2e-server-models  # needs `just web` up *and* LM Studio serving
```

`e2e/scenarios/` needs no server: it covers `--help` / `--version`, usage errors
and their exit codes, the `--` option terminator, colour suppression, local
scenario-file validation, and the guidance shown when the dashboard is
unreachable. `e2e/scenarios/server/` is kept separate because it expects a live
dashboard on `:5175`; `just cli-e2e` does not descend into it.

Within that directory `models.yaml` is split off again and run only by
`just cli-e2e-server-models`, because `models` is the one read-only command that
reaches past the dashboard: `/api/models` proxies LM Studio, and with LM Studio
down the server answers 503 and the CLI exits 2. `just cli-e2e-server` names
`read-only.yaml` explicitly so it stays green with only `just web` running.

`just check` deliberately leaves these out — pitty has to compile the binary
first, which is far slower than the rest of the gates. Run `just cli-e2e`
alongside `just check` when touching `apps/cli`.

## Documentation

- [SETUP.md](SETUP.md) — development environment onboarding
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — overview and data flow
- [docs/knowledge/](docs/knowledge/index.md) — every technical decision, one file each (OKF v0.2)

日本語版: [docs/ja/SETUP.md](docs/ja/SETUP.md) / [docs/ja/ARCHITECTURE.md](docs/ja/ARCHITECTURE.md) / [docs/ja/knowledge/](docs/ja/knowledge/index.md)

## License

[MIT](LICENSE)
