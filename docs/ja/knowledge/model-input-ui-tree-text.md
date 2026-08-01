---
type: Decision
title: "Model input: UI tree text only"
description: Screenshots are stored and shown but never sent to the model.
status: stable
tags: [llm, prompt, screenshots]
sources:
  - id: packages
    resource: 9a605b48b22b69e5e465e86bb4aeca2b1e1aecc4
    title: Implement core, adb, agent, and store packages
---

スクリーンショットは取得・保存しダッシュボードに表示しますが、モデルには渡しません。
テキストのみのプロンプトは小さく速く、UI ツリーには操作に必要な resource ID と
アクセシビリティラベルが既に含まれています。

*なぜ画像入力を使わないか:* Gemma 4 は画像を扱えるので精度が必要になれば解禁でき
ますが、トークンとレイテンシの実コストが伴います。
