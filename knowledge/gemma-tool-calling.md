---
type: Measurement
title: MLX 版 Gemma 4 の tool call 安定性
description: >-
  LM Studio 0.4.24 + MLX の gemma-4-26b-a4b-qat は tool_calls を安定して返す。
  「MLX 系 Gemma の tool-call パーサは信用できない」という以前の前提は、この構成では成り立たなかった。
status: stable
tags: [llm, tool-calling, measurement]
generated: { by: claude-opus-5/1m, at: 2026-09-20T03:05:00Z }
verified:
  - { by: claude-opus-5/1m, at: 2026-09-20T03:02:00Z }
stale_after: 2027-03-20T00:00:00Z
sources:
  - id: raw-curl
    resource: "gemma-4-26b-a4b-qat への 15 試行（curl 直接 11: 単一ツール 1・4 ツール 5・7 ツール 5／Genkit 経由 4: スパイク 2・実 decide 3）"
    title: 手元計測（2026-09-20）
    author: claude-opus-5/1m
    last_modified: 2026-09-20T03:02:00Z
  - id: prior-comment
    resource: packages/agent/src/llm.ts
    title: 変更前の llm.ts に書かれていた前提
    author: human:kexi
    last_modified: 2026-09-19T00:00:00Z
---

# 結論

**この構成では tool call は壊れない。** curl 直接 11 試行すべてが
`finish_reason: "tool_calls"` を返し、`arguments` はすべて valid JSON だった。
Genkit 経由の 4 試行も同じく全て tool call になった（計 15/15）。[^raw-curl]

変更前の `llm.ts` は structured output を選ぶ理由をこう書いていた。[^prior-comment]

> the tool-call parsers in MLX-family Gemma builds are unreliable

**この前提は、下記の条件では再現しなかった。**

# 計測条件

条件の無い数字は条件が変わった瞬間に嘘になるので、測った環境をすべて書く。

| 項目 | 値 |
|---|---|
| モデル | `google/gemma-4-26b-a4b-qat`（MLX, QAT, 15.64 GB） |
| ランタイム | LM Studio 0.4.24+1（MLX） |
| context / parallel | 262144 / 4 |
| ホスト | MacBook Pro Mac14,5 / M2 Max / 96GB / macOS 27.0 |
| temperature | 0 |
| 経路 | (a) `/v1/chat/completions` へ curl 直接、(b) Genkit 1.40.1 + @genkit-ai/compat-oai 1.40.1 |

# 結果

| 試行 | ツール数 | 回数 | tool_calls | 引数 JSON | 選択 |
|---|---|---|---|---|---|
| 単一ツール | 1 | 1 | 1/1 | valid | `tap(index=7)` 正解 |
| 複数から選択 | 4 | 5 | 5/5 | valid | 全て `type_text(index=3)` |
| 実スキーマ相当 | 7 | 5 | 5/5 | valid | 全て `tap(ref=3)` |
| Genkit 経由（スパイク） | 2 | 2 | 2/2 | valid | `tap(ref=0)` |
| Genkit 経由（実 decide） | 7 | 3 | 3/3 | valid | 下記 3 ケース |

enum 制約（`verdict` / `direction` / `key`）、`minimum`、複数必須フィールドの
いずれも崩れなかった。`reasoning_content` は `content` と分離して返る。

実エージェント（`GenkitLlm.decide`）での 3 ケース:

```
✓ tap a button:      {"type":"input_text","ref":0,"text":"user@example.com"} (3437ms)
✓ finish when met:   {"type":"finish","verdict":"passed","reason":"..."}     (2565ms)
✓ remember a value:  {"type":"remember","text":"A1B2C3"}                     (3001ms)
```

# 検証していないこと

この計測が**言っていない**ことを明示する。ここを超えて一般化すると、
まさに今回訂正した種類の誤りを繰り返す。

- **12b は測っていない。** ディスクに存在しなかった（`gemma-4-26b-a4b-qat` のみ）
- **e4b も測っていない。** 以前「E4B が measurably `anyOf` を返す」と
  記録されていたが、今回そのモデルは手元に無い
- **マルチターンを測っていない。** tool 結果を返して続ける往復は未検証。
  ただし本プロジェクトの用途ではアクションの結果は「次の画面」として
  次回プロンプトに入るため、Genkit の tool ループ自体を使っていない
- **実運用サイズのコンテキストを測っていない。** 実際の UI ダンプは
  テスト用の 3〜4 行より遥かに大きい
- **MLX 以外は測っていない。** 「MLX だから壊れる」が否定されただけで、
  「GGUF なら安定する / しない」は依然として未知

# Genkit 経由で判明したこと

実装で踏む必要のある差異。

- `toolChoice: "required"` と `returnToolRequests: true` はどちらも
  OpenAI 互換プラグイン経由で機能した
- **`part.toolRequest.ref` は Genkit の呼び出し ID であり、要素 ref ではない。**
  我々の要素 ref は `part.toolRequest.input.ref` に入る。この 2 つは名前が
  衝突しているので取り違えやすい
- `ai.defineTool` は Genkit インスタンスに名前を登録するため、リクエスト毎に
  定義し直すとレジストリが run の長さだけ増える

[^raw-curl]: 手元計測（2026-09-20）。試行内容は上表のとおり。
[^prior-comment]: 変更前の `packages/agent/src/llm.ts` の `GenkitLlm` docstring。
