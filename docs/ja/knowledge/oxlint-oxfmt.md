---
type: Decision
title: oxlint and oxfmt
description: Rust-based lint and format, fast enough for a pre-commit hook.
status: stable
tags: [tooling, lint, format]
sources:
  - id: bootstrap
    resource: 4682268c1b8b079b6cfec4b6596d8b9c2b7a0029
    title: Bootstrap reproducible dev environment and supply-chain guards
---

Rust 製で TS/TSX をネイティブに扱え、staged ファイルに対する pre-commit フックで
実用的な速度が出ます。devshell ではなく `devDependencies` に置いているのは、
JS ツールチェーンのバージョンを workspace 側で一体管理するほうが Expo
エコシステムと整合するためです。

*なぜ ESLint + Prettier でないか:* 遅く、監査対象のプラグイン面が大きすぎます。
*留意点:* oxfmt は 1.0 前です。不安定なら `fmt` 系タスクだけ切り離せます。
