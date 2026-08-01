---
type: Decision
title: "Web dashboard: Vite + React + Hono + MUI"
description: The runner is operated from a browser from day one, not a CLI.
status: stable
tags: [dashboard, hono, react, mui]
sources:
  - id: dashboard
    resource: e0ca7be5d719ac7fbd82869150877868fcbe7dce
    title: Add the web dashboard so runs are driven and read from a browser
---

ランナーの操作は最初からブラウザで行います(プロンプト投入・ステップの逐次表示・
スクリーンショット閲覧)。Hono はエージェントプロセスと同居し、SSE/WebSocket で
進捗を配信します。MUI + MUI Icons でデータ密度の高い画面をデザイン自作なしに
組みます。

*なぜ CLI 先行でないか:* 主要なデバッグ材料がステップログとスクリーンショット
であり、ターミナルはどちらの表示にも向きません。
