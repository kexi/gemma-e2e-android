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

- **Nix flake + direnv** — SDK・Zulu JDK・Bun・各 CLI を `flake.lock` で固定するため、
  「自分の環境では動く」が「あなたの環境でも動く」になります。Android SDK は
  [android-nixpkgs](https://github.com/tadfisher/android-nixpkgs) から取得し
  Android Studio を不要にしています。`adb` は SDK 由来の 1 本のみで、nixpkgs の
  `android-tools` とは二重化させません。
- **just** — npm scripts の羅列ではなく、`just --list` で発見できる薄いタスク一覧。
- **lefthook + gitleaks** — 秘密情報は修正が安いコミット時点で止めます。push 済みの
  鍵のローテーションは安くありません。
- **Renovate** — 依存更新をローカルと同じ公開後日数ポリシーで PR にします。
- **英語を原本とし日本語を併置** — ドキュメントとコメントは英語で書き、`docs/ja/`
  に日本語版を置きます。
- **MIT ライセンス。**
