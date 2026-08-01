---
type: Decision
title: Supply-chain minimum release age, in three layers
description: Nothing published in the last 24 hours enters the tree.
status: stable
tags: [security, supply-chain, renovate, actions]
sources:
  - id: bootstrap
    resource: 4682268c1b8b079b6cfec4b6596d8b9c2b7a0029
    title: Bootstrap reproducible dev environment and supply-chain guards
---

公開から 24 時間未満のものは一切取り込みません。侵害されたリリースが lockfile に
入る前に検知・取り下げされる猶予を作るためです。

| 層 | 仕組み |
| --- | --- |
| npm パッケージ | `bunfig.toml` → `minimumReleaseAge = 86400`(秒) |
| GitHub Actions | `just pin` → `pinact run --min-age 1`(日) |
| 更新 PR | `renovate.json` → `minimumReleaseAge: "1 day"` |

さらに pinact が Actions を 40 文字 SHA に固定し、タグは末尾コメントに残します。
Renovate の `helpers:pinGitHubActionDigests` がその固定を追従します。

*なぜタグを信頼しないか:* 可変タグはレビュー後に悪意あるコードへ差し替えられます。
