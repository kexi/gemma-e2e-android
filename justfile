# Development tasks. Everything assumes the nix devshell is active
# (direnv allow, or `nix develop -c just <task>`).

# Emulator AVD name shared by `create-avd` and `launch-emu`.
avd_name := "gemma-e2e-api35"
system_image := "system-images;android-35;google_apis;arm64-v8a"

# Firestore emulator. The `demo-` prefix is what makes the project id work
# entirely offline: firebase-tools never contacts Google for such a project.
firebase_project := "demo-gemma-e2e"
firestore_host := "127.0.0.1:8790"

# Show available tasks.
default:
    @just --list

# Install git hooks (idempotent). The devshell shellHook does this too.
install-hooks:
    lefthook install

# Install JavaScript dependencies (bun is the only supported package manager).
install-deps:
    bun install

lint-code:
    bun run lint

format-code:
    bun run fmt

check-format:
    bun run fmt:check

check-types:
    bun run typecheck

# Tests run against a throwaway Firestore emulator that starts and stops with
# them, so the suite never touches a developer's `just launch-db` data. Without
# FIRESTORE_EMULATOR_HOST the store's tests skip themselves instead of failing,
# which keeps a bare `bun test` usable.
run-tests:
    PATH="${FIREBASE_JAVA_HOME:+$FIREBASE_JAVA_HOME/bin:}$PATH" \
      firebase emulators:exec --only firestore --project {{ firebase_project }} 'bun test'

# Firestore emulator on its own, for a dashboard started by hand.
launch-db:
    PATH="${FIREBASE_JAVA_HOME:+$FIREBASE_JAVA_HOME/bin:}$PATH" \
      firebase emulators:start --only firestore --project {{ firebase_project }}

# Build production artifacts (currently the dashboard SPA; the Android app builds via `just launch-android`).
build-web:
    bun run --cwd apps/web build

# Platforms `build-cli-dist` cross-compiles for. musl (Alpine) is not among them:
# bun-linux-*-musl targets exist but are untested here, so they are left out
# rather than shipped unverified.
cli_targets := "bun-darwin-arm64 bun-darwin-x64 bun-linux-x64 bun-linux-arm64 bun-windows-x64"

# Compile the CLI for this machine. --no-compile-autoload-dotenv keeps the
# binary from reading whatever .env sits next to it at run time, which would
# otherwise let the repo root's file silently reconfigure a user's CLI.
build-cli:
    bun build --compile --minify --no-compile-autoload-dotenv \
      apps/cli/src/main.ts --outfile apps/cli/dist/gemma-e2e

# Cross-compile the CLI for every supported platform. The first build per
# target downloads that platform's Bun runtime into ~/.bun (needs network).
build-cli-dist:
    #!/usr/bin/env bash
    set -euo pipefail
    for target in {{ cli_targets }}; do
        platform="${target#bun-}"
        suffix=""
        case "$platform" in windows-*) suffix=".exe" ;; esac
        echo "building $platform"
        bun build --compile --minify --no-compile-autoload-dotenv \
          --target "$target" \
          apps/cli/src/main.ts \
          --outfile "apps/cli/dist/gemma-e2e-${platform}${suffix}"
    done

# Drive the compiled CLI on a real PTY and assert its output, exit codes, and
# argument handling (pitty). Everything under e2e/scenarios/ runs without a
# server; e2e/scenarios/server/ needs `just launch-web` and is excluded here, so this
# recipe is safe to run on a machine with nothing else started.
test-cli: build-cli
    GEMMA_E2E_BIN="$PWD/apps/cli/dist/gemma-e2e" pitty run e2e/scenarios

# The server-dependent half. Assumes `just launch-web` is already up on :5175, and
# nothing else: models.yaml is named explicitly by the recipe below rather than
# swept up here, because it also needs LM Studio.
test-cli-server: build-cli
    GEMMA_E2E_BIN="$PWD/apps/cli/dist/gemma-e2e" pitty run e2e/scenarios/server/read-only.yaml

# `models` proxies LM Studio, so this one needs `just launch-web` *and* LM Studio
# serving on the URL LLM_BASE_URL names. Without it the dashboard
# answers 503 and the CLI exits 2, which is correct behaviour but not what this
# scenario asserts.
test-cli-models: build-cli
    GEMMA_E2E_BIN="$PWD/apps/cli/dist/gemma-e2e" pitty run e2e/scenarios/server/models.yaml

# Run the dashboard: Firestore emulator on :8790, Hono API on :5175, and the
# Vite dev server on :5173.
launch-web:
    #!/usr/bin/env bash
    set -euo pipefail
    # dev:server runs with cwd apps/web, where bun would not see the repo-root
    # .env, so the recipe exports it before either process starts.
    if [ -f .env ]; then set -a; . ./.env; set +a; fi
    export FIRESTORE_EMULATOR_HOST="{{ firestore_host }}"
    export GOOGLE_CLOUD_PROJECT="{{ firebase_project }}"
    # All three processes share this shell's process group, so one Ctrl-C stops
    # the set; the trap covers the case where only one dies on its own.
    trap 'kill 0' EXIT INT TERM
    PATH="${FIREBASE_JAVA_HOME:+$FIREBASE_JAVA_HOME/bin:}$PATH" \
      firebase emulators:start --only firestore --project {{ firebase_project }} &
    # The API refuses to write until Firestore answers, so wait for the port
    # rather than racing it. 30 x 1s is generous for a local JVM start.
    for _ in $(seq 30); do
        if nc -z 127.0.0.1 8790 2>/dev/null; then break; fi
        sleep 1
    done
    bun run --cwd apps/web dev:server &
    bun run --cwd apps/web dev &
    wait

# Full-history secret scan (the pre-commit hook only sees staged changes).
scan-secrets:
    gitleaks git --redact

# Pin every GitHub Action to a 40-char SHA (--min-age 1 refuses releases younger than a day).
#
# The workflow paths are spelled out rather than left to pinact's default search.
# Bare `pinact run` walks the working tree without consulting .gitignore, so it
# also reaches `.direnv/flake-inputs/`, where direnv materialises the Nix store
# copies of third-party flake inputs. Those are other projects' actions: we can
# neither edit them nor pin them, and one of them (pitty-action) carries a
# SHA-pinned `uses:` without the version comment pinact demands, so the default
# search fails the gate on code that is not ours and is not even committed.
# Adding `.direnv/` to a pinact ignore config was the alternative, but that
# encodes one tool's cache directory into the pin policy and would silently stop
# covering a genuinely new workflow file; naming what we own keeps the scope
# explicit and fails loudly if a path is renamed.
pin-actions:
    pinact run --min-age 1 .github/workflows/*.yml

# Offline: verifies every `uses:` is a 40-char SHA without calling the API.
check-pins:
    pinact run -fix=false -no-api .github/workflows/*.yml

# Verify the knowledge bundle: OKF v0.2 conformance and the tag vocabulary.
lint-knowledge:
    ./scripts/lint-knowledge.sh

# Every gate a change has to clear, run locally. A superset of CI: it adds the
# typecheck, tests and action-pin check that CI does not have jobs for yet, so a
# green `just check-all` implies a green CI but not the reverse.
check-all: lint-code check-format check-types run-tests scan-secrets check-pins lint-knowledge

# Create the development AVD (AVDs live in ~/.android/avd, outside nix; this recipe is the reproducible part).
create-avd:
    avdmanager create avd --force --name {{ avd_name }} --package "{{ system_image }}" --device pixel_7

# Boot the AVD headless. Drop --no-window to watch the screen.
# -grpc 8554 exposes the EmulatorController service the dashboard's Device page
# streams frames from. It binds to localhost only and, without -grpc-use-token
# or -grpc-use-jwt, takes no authentication -- acceptable because the port never
# leaves the machine. Nothing else in the repo depends on it, so dropping the
# flag only costs the live view.
launch-emu:
    emulator -avd {{ avd_name }} -no-window -no-audio -no-boot-anim -grpc 8554

# Mirror the connected device/emulator screen in a window (works while launch-emu runs headless).
mirror-screen:
    scrcpy --stay-awake

# Prebuild (CNG) and install the example app on the running emulator/device.
launch-android:
    bun run --cwd apps/example-android android

# Serve the example app's web build on :5174, which web scenarios point at.
launch-example-web:
    bun run --cwd apps/example-web dev

# Chrome with the DevTools endpoint web scenarios drive it through. A profile
# of its own, so an already-running Chrome does not have to be closed first --
# a second instance sharing the default profile refuses to open the port.
launch-chrome:
    #!/usr/bin/env bash
    set -euo pipefail
    profile="${TMPDIR:-/tmp}/gemma-e2e-chrome"
    for candidate in \
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
        "$(command -v google-chrome-stable || true)" \
        "$(command -v google-chrome || true)" \
        "$(command -v chromium || true)"; do
        if [ -x "$candidate" ]; then chrome="$candidate"; break; fi
    done
    if [ -z "${chrome:-}" ]; then
        echo "Chrome not found. Install it, or set CHROME_ENDPOINT to one already listening." >&2
        exit 1
    fi
    # Same variable the server reads, so moving the port moves both halves.
    exec "$chrome" --remote-debugging-port="${CHROME_PORT:-9222}" --user-data-dir="$profile" --no-first-run

# Drive the example web app through the real CdpClient and print what the model
# would see. Needs `just launch-example-web` and `just launch-chrome` running; deliberately
# outside `just check-all`, since CI has no browser. This is the only thing that
# exercises the DOM collector -- it runs inside the page, so no unit test reaches
# it, and happy-dom cannot stand in (it has no layout, so every rect is zero).
check-cdp:
    bun run packages/cdp/scripts/check.ts

# Start the LM Studio local OpenAI-compatible API (http://localhost:1234/v1).
launch-llm:
    #!/usr/bin/env bash
    set -euo pipefail
    if ! command -v lms >/dev/null 2>&1; then
        echo "lms not found. LM Studio is a GUI app and is not managed by nix." >&2
        echo "Install it from https://lmstudio.ai/ then set up the CLI:" >&2
        echo "  https://lmstudio.ai/docs/cli  (~/.lmstudio/bin/lms bootstrap)" >&2
        exit 1
    fi
    lms server start

# Model for E2E runs and visual reviews when none is named: Gemma 4 26B-A4B QAT
# (MLX) passed every E2E case on Android and web, and every one-step tool-call
# case, in the 2026-09 benchmarks.
default_model := "google/gemma-4-26b-a4b-qat"

# A bare Hugging Face repo name does not resolve in `lms get`, hence the URL form:
# `just get-model https://huggingface.co/lmstudio-community/gemma-4-E4B-it-QAT-GGUF gguf`.
# On a large download the CLI can give up with "Timed-out" while LM Studio keeps
# downloading; run the recipe again once it finishes, or to resume.
# Download a model into LM Studio: a catalog key (the default) or a Hugging Face URL.
get-model model=default_model format="mlx":
    #!/usr/bin/env bash
    set -euo pipefail
    if ! command -v lms >/dev/null 2>&1; then
        echo "lms not found; see 'just launch-llm' for installing LM Studio's CLI." >&2
        exit 1
    fi
    lms get "{{ model }}" --{{ format }} --yes

# A scenario that names no model runs on LLM_MODEL. Only a model already loaded
# under that name is replaced; anything else loaded stays.
# Load a downloaded model under the name the agent requests (LLM_MODEL in .env).
launch-model model=default_model:
    #!/usr/bin/env bash
    set -euo pipefail
    if ! command -v lms >/dev/null 2>&1; then
        echo "lms not found; see 'just launch-llm' for installing LM Studio's CLI." >&2
        exit 1
    fi
    if [ -f .env ]; then set -a; . ./.env; set +a; fi
    identifier="${LLM_MODEL:?LLM_MODEL is not set; copy .env.example to .env}"
    lms unload "$identifier" >/dev/null 2>&1 || true
    lms load "{{ model }}" --identifier "$identifier" -y

# Brings up LM Studio with the model loaded, the dashboard, the example web app,
# Chrome, and the emulator with the example Android app. Anything already
# listening is left alone, so rerunning it is safe. What it does start shares
# this recipe's process group, so one Ctrl-C stops exactly that set. Each output
# line carries its source's tag, so the interleaved log stays greppable.
# Start everything scenario runs need, skipping whatever is already running.
launch-all:
    #!/usr/bin/env bash
    set -euo pipefail
    if [ -f .env ]; then set -a; . ./.env; set +a; fi
    # localhost, not 127.0.0.1: Vite binds only ::1, which an IPv4 probe misses.
    listening() { nc -z localhost "$1" 2>/dev/null; }
    skip() { echo "[launch-all] $1 already running, skipped"; }
    started=0
    start() {
        local tag="$1"
        shift
        if [ "$started" = 0 ]; then
            trap 'kill 0' EXIT INT TERM
            started=1
        fi
        just "$@" 2>&1 | awk -v tag="[$tag]" '{ print tag, $0; fflush() }' &
    }

    # The emulator is the slowest to come up, so it boots while the rest start.
    if adb devices | grep -q '^emulator-.*device$'; then skip emulator; else start emu launch-emu; fi
    if listening 5175; then skip "dashboard (:5175)"; else start web launch-web; fi
    if listening 5174; then skip "example web app (:5174)"; else start example-web launch-example-web; fi
    if listening "${CHROME_PORT:-9222}"; then skip chrome; else start chrome launch-chrome; fi

    # One-shot steps, in the foreground: a missing LM Studio stops the recipe
    # here, and the trap takes down whatever was started above.
    just launch-llm
    model="${LLM_MODEL:?LLM_MODEL is not set; copy .env.example to .env}"
    if lms ps 2>/dev/null | awk '{ print $1 }' | grep -qx "$model"; then
        skip "model $model"
    else
        just launch-model
    fi

    # The install needs a booted system, not just an adb connection.
    booted=""
    for _ in $(seq 90); do
        booted=$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)
        if [ "$booted" = 1 ]; then break; fi
        sleep 2
    done
    if [ "$booted" != 1 ]; then
        echo "[launch-all] the emulator did not finish booting within 3 minutes" >&2
        exit 1
    fi
    if listening 8081; then skip "Metro (:8081)"; else start android launch-android; fi

    if [ "$started" = 0 ]; then
        echo "[launch-all] everything was already running"
        exit 0
    fi
    echo "[launch-all] up; dashboard at http://localhost:5173. Ctrl-C stops what this started."
    wait
    # Everything started has exited on its own; the trap would only take `just`
    # down with it.
    trap - EXIT
    echo "[launch-all] everything this started has exited"
