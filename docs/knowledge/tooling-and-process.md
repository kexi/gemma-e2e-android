---
type: Decision
title: Tooling and process
description: Nix, just, lefthook, Renovate, bilingual docs, and the licence.
status: stable
tags: [nix, direnv, just, lefthook, renovate, docs]
sources:
  - id: bootstrap
    resource: 4682268c1b8b079b6cfec4b6596d8b9c2b7a0029
    title: Bootstrap reproducible dev environment and supply-chain guards
  - id: just-tasks
    resource: e24fc3239211b454fe1ad340fbf4d83dc2985b30
    title: Route app install and dependency install through just
---

- **Nix flake + direnv** — the SDK, Zulu JDK, Bun, and every CLI are pinned by
  `flake.lock`, so "works on my machine" means "works on yours". Android SDK
  comes from [android-nixpkgs](https://github.com/tadfisher/android-nixpkgs),
  keeping Android Studio out of the loop; `adb` is the SDK's copy only, never
  also nixpkgs' `android-tools`.
- **just** — a thin, discoverable task list (`just --list`) instead of a wall of
  npm scripts.
- **lefthook + gitleaks** — secrets are blocked at commit time, when the fix is
  cheap; rotating a pushed key is not.
- **Renovate** — dependency updates arrive as PRs that respect the same
  release-age policy as local installs.
- **English source, Japanese alongside** — docs and comments are written in
  English with translations under `docs/ja/`.
- **MIT license.**
