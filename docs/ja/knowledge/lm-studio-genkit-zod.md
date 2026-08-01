---
type: Decision
title: LM Studio + Gemma 4, called through Genkit with Zod
description: Decisions come back as Zod-validated structured output rather than native tool calls.
status: stable
tags: [llm, genkit, zod, lm-studio]
sources:
  - id: packages
    resource: 9a605b48b22b69e5e465e86bb4aeca2b1e1aecc4
    title: Implement core, adb, agent, and store packages
---

モデルはローカルの MLX エンジンで動かします(`gemma-4-12b`、メモリが厳しければ
E4B)。Genkit の OpenAI 互換プラグインを `http://localhost:1234/v1` に向け、操作
判断はすべて Zod で検証した構造化出力として受け取ります。

*なぜネイティブ tool call を使わないか:* MLX 系 Gemma 4 の tool call パーサが
不安定なため、構造化出力で完全に回避します。Genkit は判断ごとのトレースを Dev UI
で確認でき(「なぜそこをタップしたか」)、将来 `genkit eval` で判断品質の回帰
テストにも繋げられます。LM Studio は GUI アプリのため手動インストールです。
