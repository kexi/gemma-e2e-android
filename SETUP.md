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

```
experimental-features = nix-command flakes
```

Then install [direnv](https://direnv.net/) and
[nix-direnv](https://github.com/nix-community/nix-direnv), and hook direnv into
your shell (`direnv hook fish | source`, `eval "$(direnv hook bash)"`, …).

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

1. Install [LM Studio](https://lmstudio.ai/) and enable its `lms` CLI from the
   app's settings.
2. Download the `gemma-4-12b` model. If memory is tight, use the E4B variant
   instead.
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
just android      # expo run:android — prebuilds (CNG) and installs the login app
```

The first run generates `android/` and downloads Gradle dependencies, so it
takes a while; later runs are incremental.

## 6. Dashboard

```sh
just web
```

This starts the Hono API on `http://localhost:5175` and the Vite dev server on
`http://localhost:5173` — open the second one. From there you can run a
committed scenario, submit a one-off prompt, watch steps stream in live, and
browse the run history.

## 7. Verify

```sh
just check
```

This runs lint, format check, typecheck, a full-history secret scan, and the
Actions SHA-pin check — the same gates as CI. `just --list` shows every task.

### Troubleshooting

- **`adb devices` shows nothing / `unauthorized`** — `adb kill-server && adb start-server`, then re-accept the RSA prompt on the device.
- **Devshell looks stale after editing `flake.nix`** — `direnv reload`.
- **Emulator will not boot** — confirm the AVD exists with `avdmanager list avd`; recreate it with `just avd-create` (it passes `--force`).
- **Expo CLI on Bun** — use `bunx --bun expo …`. Without `--bun`, the `#!/usr/bin/env node` shebang wins and it runs under Node.
- **Hooks not firing** — run `just setup` (`lefthook install`).
