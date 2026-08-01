# gemma-e2e-android

Run Android end-to-end tests from natural-language prompts. You write something
like *"check that the user can log in"*; an agent driven by a local
[Gemma](https://ai.google.dev/gemma) model reads the live UI tree over `adb`,
decides the next tap or type, performs it, and judges whether the goal was met.
Everything runs on your machine — the LLM is served locally by LM Studio, so no
screenshots or app data leave the device.

## Documentation

- [SETUP.md](SETUP.md) — development environment onboarding
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — technical decisions and data flow

日本語版: [docs/ja/SETUP.md](docs/ja/SETUP.md) / [docs/ja/ARCHITECTURE.md](docs/ja/ARCHITECTURE.md)

## License

[MIT](LICENSE)
