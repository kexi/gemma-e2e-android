# Development tasks. Everything assumes the nix devshell is active
# (direnv allow, or `nix develop -c just <task>`).

# Emulator AVD name shared by `avd-create` and `emu`.
avd_name := "gemma-e2e-api35"
system_image := "system-images;android-35;google_apis;arm64-v8a"

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

test:
    bun test

# Build production artifacts (currently the dashboard SPA; the Android app builds via `just android`).
build:
    bun run --cwd apps/web build

# Run the dashboard: Hono API on :5175 and the Vite dev server on :5173.
web:
    #!/usr/bin/env bash
    set -euo pipefail
    # Both processes share this shell's process group, so one Ctrl-C stops the
    # pair; the trap covers the case where only one of them dies on its own.
    trap 'kill 0' EXIT INT TERM
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

# Local equivalent of CI.
check: lint fmt-check typecheck secrets pin-check

# Create the development AVD (AVDs live in ~/.android/avd, outside nix; this recipe is the reproducible part).
avd-create:
    avdmanager create avd --force --name {{ avd_name }} --package "{{ system_image }}" --device pixel_7

# Boot the AVD headless. Drop --no-window to watch the screen.
emu:
    emulator -avd {{ avd_name }} -no-window -no-audio -no-boot-anim

# Prebuild (CNG) and install the example app on the running emulator/device.
android:
    bun run --cwd apps/example android

# Start the LM Studio local OpenAI-compatible API (http://localhost:1234/v1).
llm:
    #!/usr/bin/env bash
    set -euo pipefail
    if ! command -v lms >/dev/null 2>&1; then
        echo "lms not found. LM Studio is a GUI app and is not managed by nix." >&2
        echo "Install it from https://lmstudio.ai/ then run its CLI bootstrap." >&2
        exit 1
    fi
    lms server start
