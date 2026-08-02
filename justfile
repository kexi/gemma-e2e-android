# Development tasks. Everything assumes the nix devshell is active
# (direnv allow, or `nix develop -c just <task>`).

# Emulator AVD name shared by `avd-create` and `emu`.
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
setup:
    lefthook install

# Install JavaScript dependencies (bun is the only supported package manager).
install:
    bun install

lint:
    bun run lint

fmt:
    bun run fmt

fmt-check:
    bun run fmt:check

typecheck:
    bun run typecheck

# Tests run against a throwaway Firestore emulator that starts and stops with
# them, so the suite never touches a developer's `just db` data. Without
# FIRESTORE_EMULATOR_HOST the store's tests skip themselves instead of failing,
# which keeps a bare `bun test` usable.
test:
    PATH="${FIREBASE_JAVA_HOME:+$FIREBASE_JAVA_HOME/bin:}$PATH" \
      firebase emulators:exec --only firestore --project {{ firebase_project }} 'bun test'

# Firestore emulator on its own, for a dashboard started by hand.
db:
    PATH="${FIREBASE_JAVA_HOME:+$FIREBASE_JAVA_HOME/bin:}$PATH" \
      firebase emulators:start --only firestore --project {{ firebase_project }}

# Build production artifacts (currently the dashboard SPA; the Android app builds via `just android`).
build:
    bun run --cwd apps/web build

# Platforms `cli-dist` cross-compiles for. musl (Alpine) is not among them:
# bun-linux-*-musl targets exist but are untested here, so they are left out
# rather than shipped unverified.
cli_targets := "bun-darwin-arm64 bun-darwin-x64 bun-linux-x64 bun-linux-arm64 bun-windows-x64"

# Compile the CLI for this machine. --no-compile-autoload-dotenv keeps the
# binary from reading whatever .env sits next to it at run time, which would
# otherwise let the repo root's file silently reconfigure a user's CLI.
cli:
    bun build --compile --minify --no-compile-autoload-dotenv \
      apps/cli/src/main.ts --outfile apps/cli/dist/gemma-e2e

# Cross-compile the CLI for every supported platform. The first build per
# target downloads that platform's Bun runtime into ~/.bun (needs network).
cli-dist:
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
# server; e2e/scenarios/server/ needs `just web` and is excluded here, so this
# recipe is safe to run on a machine with nothing else started.
cli-e2e: cli
    GEMMA_E2E_BIN="$PWD/apps/cli/dist/gemma-e2e" pitty run e2e/scenarios

# The server-dependent half. Assumes `just web` is already up on :5175, and
# nothing else: models.yaml is named explicitly by the recipe below rather than
# swept up here, because it also needs LM Studio.
cli-e2e-server: cli
    GEMMA_E2E_BIN="$PWD/apps/cli/dist/gemma-e2e" pitty run e2e/scenarios/server/read-only.yaml

# `models` proxies LM Studio, so this one needs `just web` *and* LM Studio
# serving on the URL LLM_BASE_URL names. Without it the dashboard
# answers 503 and the CLI exits 2, which is correct behaviour but not what this
# scenario asserts.
cli-e2e-server-models: cli
    GEMMA_E2E_BIN="$PWD/apps/cli/dist/gemma-e2e" pitty run e2e/scenarios/server/models.yaml

# Run the dashboard: Firestore emulator on :8790, Hono API on :5175, and the
# Vite dev server on :5173.
web:
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
secrets:
    gitleaks git --redact

# Pin every GitHub Action to a 40-char SHA (--min-age 1 refuses releases younger than a day).
pin:
    pinact run --min-age 1

# Offline: verifies every `uses:` is a 40-char SHA without calling the API.
pin-check:
    pinact run -fix=false -no-api

# Every gate a change has to clear, run locally. A superset of CI: it adds the
# typecheck, tests and action-pin check that CI does not have jobs for yet, so a
# green `just check` implies a green CI but not the reverse.
check: lint fmt-check typecheck test secrets pin-check

# Create the development AVD (AVDs live in ~/.android/avd, outside nix; this recipe is the reproducible part).
avd-create:
    avdmanager create avd --force --name {{ avd_name }} --package "{{ system_image }}" --device pixel_7

# Boot the AVD headless. Drop --no-window to watch the screen.
# -grpc 8554 exposes the EmulatorController service the dashboard's Device page
# streams frames from. It binds to localhost only and, without -grpc-use-token
# or -grpc-use-jwt, takes no authentication -- acceptable because the port never
# leaves the machine. Nothing else in the repo depends on it, so dropping the
# flag only costs the live view.
emu:
    emulator -avd {{ avd_name }} -no-window -no-audio -no-boot-anim -grpc 8554

# Mirror the connected device/emulator screen in a window (works while emu runs headless).
mirror:
    scrcpy --stay-awake

# Prebuild (CNG) and install the example app on the running emulator/device.
android:
    bun run --cwd apps/example-android android

# Serve the example app's web build on :5174, which web scenarios point at.
example-web:
    bun run --cwd apps/example-web dev

# Chrome with the DevTools endpoint web scenarios drive it through. A profile
# of its own, so an already-running Chrome does not have to be closed first --
# a second instance sharing the default profile refuses to open the port.
chrome:
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
    exec "$chrome" --remote-debugging-port=9222 --user-data-dir="$profile" --no-first-run

# Drive the example web app through the real CdpClient and print what the model
# would see. Needs `just example-web` and `just chrome` running; deliberately
# outside `just check`, since CI has no browser. This is the only thing that
# exercises the DOM collector -- it runs inside the page, so no unit test reaches
# it, and happy-dom cannot stand in (it has no layout, so every rect is zero).
cdp-check:
    bun run packages/cdp/scripts/check.ts

# Start the LM Studio local OpenAI-compatible API (http://localhost:1234/v1).
llm:
    #!/usr/bin/env bash
    set -euo pipefail
    if ! command -v lms >/dev/null 2>&1; then
        echo "lms not found. LM Studio is a GUI app and is not managed by nix." >&2
        echo "Install it from https://lmstudio.ai/ then set up the CLI:" >&2
        echo "  https://lmstudio.ai/docs/cli  (~/.lmstudio/bin/lms bootstrap)" >&2
        exit 1
    fi
    lms server start
