# Quick setup

日本語版: [docs/ja/QUICK-SETUP.md](docs/ja/QUICK-SETUP.md)

For trying the project right after cloning it: the shortest path from
`git clone` to a scenario running on the dashboard. Each step links to the part
of [SETUP.md](SETUP.md) that explains it, for when something goes wrong or you
want the details.

## Before you start (once per machine)

1. **Nix with flakes, direnv and nix-direnv**, with direnv hooked into your
   shell — [SETUP.md §1](SETUP.md#1-prerequisites-nix-and-direnv).
2. **LM Studio** (a GUI app, not managed by Nix) and its `lms` CLI:
   install from <https://lmstudio.ai/>, then run `~/.lmstudio/bin/lms bootstrap`
   — [SETUP.md §4](SETUP.md#4-lm-studio-and-gemma).
3. **Google Chrome**, for web scenarios.

## Steps

```sh
git clone https://github.com/kexi/gemma-e2e-android
cd gemma-e2e-android
direnv allow             # first time: downloads the Android SDK and emulator image (several GB, 10+ min)
just install-deps        # JavaScript dependencies
cp .env.example .env     # LLM_MODEL and friends; the defaults work as they are

# One-time setup
just launch-llm          # start LM Studio's local API
just get-model           # download Gemma 4 26B-A4B QAT (MLX), ~16 GB
just create-avd          # create the gemma-e2e-api35 emulator

# Every time
just launch-all
```

`just launch-all` brings up everything a run needs in one terminal: LM Studio
with the model loaded, the emulator with the example Android app, the example
web app, Chrome, and the dashboard. The first run builds the Android app, so it
takes a few minutes. Whatever is already running is skipped, so it is safe to
run again, and one Ctrl-C stops what it started.

When it prints `up; dashboard at http://localhost:5173`, open
<http://localhost:5173>, pick a scenario in the rail, and press its play button.

## If something fails

- **`lms` not found** — LM Studio's CLI is not on your PATH yet; see step 2 above.
- **Port already in use** — another process holds 5173, 5174, 5175, 8081, 8790 or
  9222. `launch-all` skips a port that is already listening, so stop the other
  process or start that piece yourself.
- **Anything else** — [SETUP.md](SETUP.md) walks through each piece on its own,
  with a troubleshooting section at the end.
