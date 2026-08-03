# Setup

Onboarding for the development environment. Every CLI tool except LM Studio is
declared in `flake.nix`, so there is nothing to install by hand beyond Nix,
direnv, and the LM Studio desktop app.

日本語版: [docs/ja/SETUP.md](docs/ja/SETUP.md)

## 1. Prerequisites: Nix and direnv

Install Nix with flakes enabled. The
[Determinate Systems installer](https://github.com/DeterminateSystems/nix-installer)
turns flakes on for you:

```sh
curl --proto '=https' --tlsv1.2 -sSf -L https://install.determinate.systems/nix | sh -s -- install
```

With an existing Nix install, make sure `~/.config/nix/nix.conf` contains:

```text
experimental-features = nix-command flakes
```

Then install [direnv](https://direnv.net/) and
[nix-direnv](https://github.com/nix-community/nix-direnv) (nix-direnv caches
the devshell so entering the directory is instant):

```sh
# macOS (Homebrew)
brew install direnv nix-direnv
# or with Nix itself
nix profile install nixpkgs#direnv nixpkgs#nix-direnv
```

Hook direnv into your shell:

```sh
# fish: ~/.config/fish/config.fish
direnv hook fish | source

# zsh: ~/.zshrc          # bash: ~/.bashrc
eval "$(direnv hook zsh)"
```

And point direnv at nix-direnv in `~/.config/direnv/direnvrc`:

```sh
# Homebrew install
source "$(brew --prefix)/share/nix-direnv/direnvrc"
# nix profile install
source "$HOME/.nix-profile/share/nix-direnv/direnvrc"
```

## 2. Enter the devshell

```sh
direnv allow
```

The first build downloads the Android SDK, platform tools, and an emulator
system image — **several GB, expect 10+ minutes** on a fresh machine. Later
entries are instant.

Without direnv, prefix commands with `nix develop -c`, e.g. `nix develop -c just check`.

Entering the shell also runs `lefthook install`, so the pre-commit hooks
(gitleaks, pinact, oxlint, oxfmt) are wired up automatically.

## 3. Install JavaScript dependencies

```sh
just install    # = bun install
```

`bunfig.toml` sets `minimumReleaseAge = 86400`, so packages published within
the last day are rejected. If an install fails for that reason, the package is
too fresh — wait, or add a targeted `minimumReleaseAgeExcludes` entry.

## 4. LM Studio and Gemma

LM Studio is a GUI app, so it is not managed by Nix.

1. Install [LM Studio](https://lmstudio.ai/) and set up its `lms` CLI —
   see the [lms CLI guide](https://lmstudio.ai/docs/cli) (`~/.lmstudio/bin/lms
   bootstrap` adds it to your PATH).
2. Download the `gemma-4-12b` model. If memory is tight, use the E4B variant
   instead. Set `LLM_MODEL` in `.env` to whatever `lms ps` reports — that value
   is the last fallback in the `case.model → scenario.model → LLM_MODEL` chain,
   so a scenario that names no model runs on it.
3. Start the OpenAI-compatible server:

   ```sh
   just llm    # = lms server start
   ```

The agent talks to `http://localhost:1234/v1`. Point it at mlx-lm or Ollama by
changing the base URL.

## 5. Emulator or device

```sh
just avd-create   # creates the gemma-e2e-api35 AVD (Android 35, arm64-v8a)
just emu          # boots it headless
adb devices       # should list the emulator
```

For a physical device instead: enable Developer options → USB debugging, plug
it in, and accept the RSA prompt; `adb devices` will show it.

With a device or emulator online, build and install the example app:

```sh
just android      # expo run:android — prebuilds (CNG) and installs "Kexi Coffee Shop"
```

The first run generates `android/` and downloads Gradle dependencies, so it
takes a while; later runs are incremental.

## 5b. Chrome, for web scenarios

Scenarios naming a `web` target drive Chrome over the DevTools Protocol. Two
processes: the app under test, and a browser with the debugging port open.

```sh
just example-web  # the shop, in the browser → http://localhost:5174
just chrome       # Chrome --remote-debugging-port=9222
```

`just chrome` uses a profile of its own under `$TMPDIR`, so an already-running
Chrome does not have to be closed first — a second instance sharing the default
profile refuses to open the port. To drive a browser started some other way,
point `CHROME_ENDPOINT` at it instead.

Nothing needs to be running for the dashboard to boot: the driver connects on
first use, so a web case simply errors with the flag to start Chrome with. Only
that case fails; the rest of the run continues.

`just cdp-check` drives the example app through the real client and prints the
tree the model would read. It is the only thing that exercises the DOM
collector, which runs inside the page and therefore has no unit tests, so it is
worth running after touching `packages/cdp`.

## 6. Firestore emulator

Run history lives in Firestore. Development never touches a real Google
project: the emulator runs locally under the project id `demo-gemma-e2e`, whose
`demo-` prefix makes firebase-tools work entirely offline with no credentials
and no billing account.

```sh
just db     # Firestore emulator on 127.0.0.1:8790
```

`just web` starts this for you, so the standalone recipe is only needed when
running the API server by hand. `firebase.json` holds the port; `.firebaserc`
holds the project id. The emulator is a Java program that firebase-tools
downloads on first run, and it stores nothing between restarts — every `just db`
starts from an empty database.

Anything talking to it needs two variables, which `just web` and `just test`
export automatically:

```sh
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8790
export GOOGLE_CLOUD_PROJECT=demo-gemma-e2e
```

`firestore.rules` denies every client read and write. That is deliberate: the
only writer is the dashboard's server process through the Admin SDK, which
bypasses rules entirely, so a browser pointed at this project fails loudly
instead of exposing run history.

## 7. Dashboard

```sh
just web
```

This starts three processes — the Firestore emulator on `127.0.0.1:8790`, the
Hono API on `http://localhost:5175`, and the Vite dev server on
`http://localhost:5173`. Open the last one. From there you can run a committed
scenario, submit a one-off prompt against a model of your choice, watch steps
stream in live under each case, and browse the run history. **New scenario** in
the rail opens a builder that writes `scenarios/<id>.yaml` — a git-managed file
you still have to commit, and one it refuses to overwrite if it already exists.

### Live device view

The **Device** page shows the emulator screen live, and a run in progress
embeds the same view next to its step timeline so you can watch the agent act.
Frames come off the emulator's gRPC bridge, so the emulator has to be started
with it — `just emu` passes `-grpc 8554` for exactly this reason. An emulator
booted without that flag still serves adb and runs scenarios; only the live
view goes dark, and the page says so.

Frames are delivered only when the screen changes, so a still device shows a
static image rather than a stalled one. The view is read-only. If it will not
connect, `just mirror` opens the same screen in scrcpy independently of the
dashboard. Point the server at a different bridge with `EMULATOR_GRPC=host:port`.

The same page also shows Chrome, through the screencast the recorder already
uses. Both platforms are always attached -- neither costs anything idle -- so
the Device page carries a picker rather than the server carrying a setting, and
an emulator that is down no longer hides the browser view. The choice is
remembered across pages and reloads. `LIVE_VIEW_URL` sets where the browser
view looks when no run is driving it.

That view opens a page of its own rather than sharing the ones a run creates,
since those are disposed with their contexts at the end of each case.

### Screen recordings

Every case is recorded end to end with scrcpy and saved as

```text
var/videos/{runId}/{caseId}.mp4
```

Once a case finishes, its accordion on the run page grows a player, so a failure
nobody watched live can still be replayed. The same recording works for
emulators and physical devices, and there is no time limit on a clip.

Web cases are filmed too, by a different route: CDP has no video capture, so
the page's screencast frames are muxed through `ffmpeg`. Like scrcpy, it is
declared in `flake.nix`, so the devshell supplies it and there is nothing to
install. The recorder resolves `ffmpeg` from `PATH` (or a configured path), so
any install will do — the devshell is simply the one that is guaranteed. The
result is lossier than scrcpy's and drops frames under fast scrolling, though
it lands in the same place and plays back in the same dashboard.

Recording is on by default and needs no setup — scrcpy comes from the devshell.
Turn it off with `RECORD_RUNS=0` in `.env` (or in the environment). It is best
effort either way: if scrcpy cannot start, the run continues unrecorded, the
server logs `record.failed`, and the case's `videoPath` stays null.

`var/` is gitignored, so recordings never reach a commit. They are also the
bulkiest thing a run produces — delete `var/videos/` when disk space matters.

## 8. Verify

```sh
just check
```

This runs lint, format check, typecheck, the test suite, a full-history secret
scan, and the Actions SHA-pin check. `just --list` shows every task.

`just test` wraps `bun test` in `firebase emulators:exec`, so the Firestore
tests get a throwaway emulator that starts and stops with them and never
touches your `just db` data. A bare `bun test` has no emulator, so those tests
skip themselves rather than fail — the run reports them as skipped.

### Troubleshooting

- **`adb devices` shows nothing / `unauthorized`** — `adb kill-server && adb start-server`, then re-accept the RSA prompt on the device.
- **Devshell looks stale after editing `flake.nix`** — `direnv reload`.
- **Emulator will not boot** — confirm the AVD exists with `avdmanager list avd`; recreate it with `just avd-create` (it passes `--force`).
- **Expo CLI on Bun** — use `bunx --bun expo …`. Without `--bun`, the `#!/usr/bin/env node` shebang wins and it runs under Node.
- **Hooks not firing** — run `just setup` (`lefthook install`).
- **"firebase-tools no longer supports Java version before 21"** — the emulator recipes prepend `$FIREBASE_JAVA_HOME/bin` to `PATH` for exactly this reason (the devshell's default JDK is 17, which AGP needs). If you invoke `firebase` directly, do the same: `PATH="$FIREBASE_JAVA_HOME/bin:$PATH" firebase …`.
- **Port 8790 already in use** — a previous `just db` is still running; stop it, or change the port in `firebase.json`.
- **Firestore tests all skipped** — that is a bare `bun test`. Use `just test`, which supplies the emulator.
