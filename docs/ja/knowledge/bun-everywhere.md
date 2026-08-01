---
type: Decision
title: "Bun everywhere: package manager, runtime, test runner"
description: One tool covers installs, TypeScript execution, and the test runner.
status: stable
tags: [bun, typescript, tooling]
sources:
  - id: bootstrap
    resource: 4682268c1b8b079b6cfec4b6596d8b9c2b7a0029
    title: Bootstrap reproducible dev environment and supply-chain guards
---

インストール・TypeScript 実行・`bun test` を 1 つのツールで賄います。Bun が TS を
そのまま実行できることが、`packages/*` のビルドレス構成を成立させています。
モノレポは Bun の `workspaces` を使います。

*なぜ pnpm + Node + Vitest でないか:* 3 つのツールと 3 つの設定を同期し続ける
必要があるためです。*受け入れたリスク:* Genkit は Bun を公式サポートしていません。
逃げ道として Node 22 を devshell に残しており、問題が出たらエージェントのみ Node で
動かします。
