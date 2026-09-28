# gemma-e2e-android

日本語版: [docs/ja/README.md](docs/ja/README.md)

Run end-to-end tests from natural-language prompts, on an Android device or in
Chrome. You write something like *"check that the user can log in"*; an agent
driven by a local [Gemma](https://ai.google.dev/gemma) model reads the live UI
tree, decides the next tap or type, performs it, and judges whether the goal was
met. Everything runs on your machine — the LLM is served locally by LM Studio,
so no screenshots or app data leave it.

Each test case names its own target, so one scenario can cover both platforms
and the prompts stay the same on either.

## How it works

```text
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

## Persona review

Persona review looks at each step's screenshot through the eyes of the people
you name, and reports what each of them would struggle with. A persona need
not be a disability: a young child who cannot read kanji yet, an older user
unfamiliar with apps or a non-native speaker are as valid as colour blindness.

In the scenario editor, use **Persona review** (「ペルソナレビュー」 in the
Japanese UI) to select personas. The presets are red–green or blue–yellow
colour distinction, presbyopia (near-text legibility), low vision, and a young
child who cannot read many kanji yet. Edit their descriptions or add a custom
persona. Each case inherits the scenario selection unless you choose its own
personas. An empty selection turns review off; existing scenarios keep review
off by default.

For YAML scenarios, describe the personas explicitly under `personaReview:`:

```yaml
title: Login with persona review
target:
  platform: web
  url: http://localhost:5174
personaReview:
  personas:
    - id: presbyopia
      label: 老眼・近くの文字の読みづらさ
      description: 小さい文字や細い線、低コントラストによる読みにくさを確認する。
    - id: kanji-reading
      label: 漢字が読みにくい（低学年の子ども）
      description: ふりがなの無い漢字や難しい言い回しで理解できない箇所がないか確認する。
cases:
  - id: login
    prompt: Check that the user can log in.
  - id: functional-only
    prompt: Check that an incorrect password is rejected.
    personaReview:
      personas: []
```

The feature was first called visual accessibility review, and its key was
`accessibility:`. Files that still use that key load unchanged, as if it were
`personaReview:`; giving both keys in one place is an error. Saving from the
dashboard rewrites the file with `personaReview:` only.

Android uses the same setting with its Android `target`. The selected case model
must support image input. Each step captures a separate **before-action** PNG,
including the initial screen and the screen on which the agent finishes. Gemma
reviews that saved image after the action, so image inference does not delay an
action chosen from the current UI tree. The selected personas are reviewed one
after another, each in its own request, with one retry for malformed output.
The persona's description decides what counts as a problem: colour-only
distinctions, contrast, text size and clutter, but also hard kanji or wording
(`language`) and steps or meanings that are hard to follow (`comprehension`).
The run timeline shows the location, reason and suggestion for each potential
issue, with a link to the reviewed image. The existing step thumbnail remains
the after-action image. Persona definitions and the model are saved with the
review (as `personaReview` on the step; runs stored before the rename, under
`accessibilityReview`, still display), so changing the scenario later does not
change the meaning of past results.

Reviews add an image-model request per persona per step, each bounded by one
deadline that covers the retry too: 120 seconds by default,
`PERSONA_REVIEW_TIMEOUT_MS` to change it (the old name,
`ACCESSIBILITY_REVIEW_TIMEOUT_MS`, is still read when the new one is unset). A
report the model writes as a fenced JSON block instead of calling the tool is
accepted after the same validation. Each review is logged as
`case.persona_reviewed`, or `case.persona_review_failed` when it fails. Failures
are recorded as review errors and do not change the functional E2E verdict.
Review covers only sampled visible screens, not every animation or transient
state. Findings are qualitative suggestions grounded in what the image shows,
not a reproduction of someone's vision or understanding, and not a WCAG
compliance result. No findings does not prove the screen works for a persona.
Exact contrast ratios, physical text sizes, ages and reading ability are not
measured. Screen-reader behavior, reading order and other nonvisual behavior are
outside this feature.

To check the review against a known answer, the example web app serves screens
with deliberately planted problems (colour-only status, tiny pale text, crowded
icons) between two clean ones at `http://localhost:5174/?lab=a11y`, and
`scenarios/a11y-lab.web.yaml` reviews them one persona per case
(`a11y-lab-all.web.yaml` uses the four visual presets at once). They are tagged
`a11y` and `lab` rather than `web`, so runs selected by the `web` tag stay fast.
The shop screens the other scenarios run against are unchanged.

The example Android app carries the same screens. An app has no URL to hold a
flag, so they open from the sign-in screen's "Store information" link, and
`scenarios/a11y-lab.yaml` / `a11y-lab-all.yaml` start their prompt there. That
link is the one change to a screen the Android login and shop scenarios see.

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

Just cloned it and want to try it? [QUICK-SETUP.md](QUICK-SETUP.md) goes from
`git clone` to a running scenario in a few commands.

```sh
direnv allow             # devshell: every CLI tool, the Android SDK, and the emulator
just install-deps        # JavaScript dependencies
just launch-all          # everything below, in one terminal; skips whatever is already up
```

`launch-all` expects the one-time setup done: LM Studio installed with a model
downloaded (`just get-model`) and the AVD created (`just create-avd`). One
Ctrl-C stops what it started. To bring the pieces up one at a time instead:

```sh
just launch-llm          # start LM Studio's local API (manual app install required)
just launch-model        # load the model under the name LLM_MODEL gives it
just launch-web          # dashboard → http://localhost:5173

# Android (scenarios/login.yaml, shop.yaml)
just launch-emu          # boot the emulator
just launch-android      # build & install the example app

# Web (scenarios/login.web.yaml, shop.web.yaml)
just launch-example-web  # the shop, in the browser → http://localhost:5174
just launch-chrome       # Chrome with the DevTools port the driver connects to
```

`just --list` shows every task; `just check-all` runs the same gates as CI.
Full onboarding, including Nix/direnv and LM Studio setup: [SETUP.md](SETUP.md).

## CLI

`gemma-e2e` drives the same API the dashboard uses, so scenarios and runs can be
managed from a terminal or a CI job. It needs the dashboard running (`just launch-web`).

```sh
just build-cli        # compile ./apps/cli/dist/gemma-e2e for this machine
just build-cli-dist   # cross-compile for macOS, Linux, and Windows
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
just test-cli         # compiles the binary, then runs e2e/scenarios/
just test-cli-server  # needs `just launch-web` up
just test-cli-models  # needs `just launch-web` up *and* LM Studio serving
```

`e2e/scenarios/` needs no server: it covers `--help` / `--version`, usage errors
and their exit codes, the `--` option terminator, colour suppression, local
scenario-file validation, and the guidance shown when the dashboard is
unreachable. `e2e/scenarios/server/` is kept separate because it expects a live
dashboard on `:5175`; `just test-cli` does not descend into it.

Within that directory `models.yaml` is split off again and run only by
`just test-cli-models`, because `models` is the one read-only command that
reaches past the dashboard: `/api/models` proxies LM Studio, and with LM Studio
down the server answers 503 and the CLI exits 2. `just test-cli-server` names
`read-only.yaml` explicitly so it stays green with only `just launch-web` running.

`just check-all` deliberately leaves these out — pitty has to compile the binary
first, which is far slower than the rest of the gates. Run `just test-cli`
alongside `just check-all` when touching `apps/cli`.

## Documentation

- [SETUP.md](SETUP.md) — development environment onboarding
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — overview and data flow
- [docs/knowledge/](docs/knowledge/index.md) — every technical decision, one file each (OKF v0.2)

日本語版: [docs/ja/SETUP.md](docs/ja/SETUP.md) / [docs/ja/ARCHITECTURE.md](docs/ja/ARCHITECTURE.md) / [docs/ja/knowledge/](docs/ja/knowledge/index.md)

## License

[MIT](LICENSE)
