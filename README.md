# gemma-e2e-android

Run Android end-to-end tests from natural-language prompts. You write something
like *"check that the user can log in"*; an agent driven by a local
[Gemma](https://ai.google.dev/gemma) model reads the live UI tree over `adb`,
decides the next tap or type, performs it, and judges whether the goal was met.
Everything runs on your machine — the LLM is served locally by LM Studio, so no
screenshots or app data leave the device.

## How it works

```
scenario prompt ─▶ agent loop:  adb uiautomator dump ─▶ UI tree (text)
                     ▲                                      │
                     │                              Gemma 4 (LM Studio)
                adb tap / type ◀── structured Action ◀──────┘
                     │
                     ▼
     Firestore history + screenshots ─▶ web dashboard (live via SSE)
```

## Repository layout

| Path | What it is |
| --- | --- |
| `packages/core` | Shared Zod schemas (UI tree, actions, runs) and the YAML scenario loader |
| `packages/adb` | adb wrapper: UI dump parsing, LLM-facing tree serialization, input commands |
| `packages/agent` | Genkit-based decision loop against LM Studio's OpenAI-compatible API |
| `packages/store` | Run/step history in Firestore (local emulator via `firebase-admin`) |
| `apps/web` | Dashboard: Hono API + SSE, Vite/React/MUI frontend |
| `apps/example` | "Kexi Coffee Shop" — the Expo store app the agent is tested against |
| `scenarios/` | Committed test scenarios (`*.yaml`) |

## Quick start

```sh
direnv allow      # devshell: every CLI tool, the Android SDK, and the emulator
just install      # JavaScript dependencies
just emu          # boot the emulator          (first time: just avd-create)
just android      # build & install the example app
just llm          # start LM Studio's local API (manual app install required)
just web          # dashboard → http://localhost:5173
```

`just --list` shows every task; `just check` runs the same gates as CI.
Full onboarding, including Nix/direnv and LM Studio setup: [SETUP.md](SETUP.md).

## Documentation

- [SETUP.md](SETUP.md) — development environment onboarding
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — overview and data flow
- [docs/knowledge/](docs/knowledge/index.md) — every technical decision, one file each (OKF v0.2)

日本語版: [docs/ja/SETUP.md](docs/ja/SETUP.md) / [docs/ja/ARCHITECTURE.md](docs/ja/ARCHITECTURE.md) / [docs/ja/knowledge/](docs/ja/knowledge/index.md)

## License

[MIT](LICENSE)
