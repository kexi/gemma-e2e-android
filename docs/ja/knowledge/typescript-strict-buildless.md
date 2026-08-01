---
type: Decision
title: TypeScript strict, buildless packages
description: Every workspace extends one strict base config, and packages ship TS sources directly.
status: stable
tags: [typescript, tooling]
sources:
  - id: bootstrap
    resource: 4682268c1b8b079b6cfec4b6596d8b9c2b7a0029
    title: Bootstrap reproducible dev environment and supply-chain guards
---

`tsconfig.base.json` で `strict` / `noUncheckedIndexedAccess` /
`exactOptionalPropertyTypes` などを有効にし、全 app / package がこれを extends
します。`packages/*` は TS ソースのまま workspace 内で参照されます。

*なぜ今バンドラを入れないか:* 消費側が同一リポジトリ内の Bun だけである以上、
ビルド段階に得るものがありません。npm publish や単一ファイル化が必要になった
時点で [tsdown](https://tsdown.dev/) を導入します。
