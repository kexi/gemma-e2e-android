---
type: Decision
title: "Scenarios: files plus ad-hoc runs"
description: Committed YAML scenarios, with one-off prompts modelled as a scenario of one case.
status: stable
tags: [scenarios, yaml, dashboard]
sources:
  - id: dashboard
    resource: e0ca7be5d719ac7fbd82869150877868fcbe7dce
    title: Add the web dashboard so runs are driven and read from a browser
  - id: cases
    resource: 1b7eb616f74a32eab55cc6f464bce14e3f83666e
    title: Model scenarios as bundles of cases, and persist runs in Firestore
---

テストシナリオは YAML としてリポジトリに置き、レビュー・バージョン管理・CI での
再実行を可能にします。加えてダッシュボードからコミットされていない単発のプロンプトも
実行でき、モデルはドロップダウンから選べます。中身は `GET /api/models` が LLM
エンドポイントの `/v1/models` から取得します。

*なぜモデル一覧をサーバ経由にするか:* LM Studio は CORS ヘッダを返さないため、
ブラウザから直接呼べません。埋め込みモデルは ID で除外しています。判断を生成できず、
選んでも失敗する run にしかならないためです。

ad-hoc プロンプトはケース 1 件だけのシナリオになります。ランナーが扱う形が 1 つで
済み、ファイル由来かフォーム由来かによらず履歴の見た目が揃います。
