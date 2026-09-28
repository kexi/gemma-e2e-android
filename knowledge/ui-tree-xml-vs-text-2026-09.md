---
type: Measurement
title: 画面をXMLで渡すとテキストより操作精度が落ちた
description: >-
  全シナリオをXML（全ノード・全属性・独自ref）に切り替えて流すと8本中7本成功、
  Androidのアクセシビリティラボ（1ケース1ペルソナ）は2/4に落ちた。同じシナリオはテキストで4/4。
  既定はテキストのまま。各形式1回ずつの比較。
status: draft
tags: [llm, measurement]
generated: { by: claude-opus-5-5/1m, at: 2026-09-28T07:30:00Z }
verified:
  - { by: claude-opus-5-5/1m, at: 2026-09-28T07:30:00Z }
stale_after: 2026-12-28T00:00:00Z
sources:
  - id: runs
    resource: "2026-09-28、ローカル Firestore の run（XML: 8c5082d7 / 6ab429ba / f19f7f14 / 54894346 / 96e9cef2 / 1472ea91 / deb9fc99 / 9c91ef77、テキスト比較: e8532209）"
    title: 全シナリオのXML実行と、Androidラボのテキスト比較
  - id: design
    resource: ../docs/knowledge/model-input-ui-tree-text.md
    title: 画面の渡し方（テキスト / XML）の切り替えと既定の理由
---

# 結論

**画面をXMLで渡すと、要素が密集した画面で操作判断が崩れた。既定はテキストのままにした。**
XMLはシナリオかケースに `uiFormat: xml` と書いたときだけ使う。

# 条件

| 項目 | 値 |
|---|---|
| モデル | `google/gemma-4-26b-a4b-qat`（MLX、LM Studio、思考あり） |
| XML | 全ノード（省略なし）、`bounds` と uiautomator の全属性、画面内で一意の独自 `ref`。uiautomator の `index` は出さない |
| テキスト | 従来の簡約テキスト（押せる要素に `[番号]`、座標なし） |
| 画面 | Android エミュレーター API 35 と Web（Chrome、CDP） |
| 反復 | 各形式1回ずつ |

# 結果

全シナリオをXMLにした実行:[^runs]

| シナリオ | 結果 |
|---|---|
| Login（Android / Web） | 成功 / 成功 |
| Coffee shop（Android / Web） | 成功 / 成功 |
| Accessibility lab、全ペルソナ一括（Android / Web） | 成功 / 成功 |
| Accessibility lab、1ケース1ペルソナ（Web） | 4/4 成功（各6ステップ） |
| Accessibility lab、1ケース1ペルソナ（Android） | **2/4**（2ケースが13ステップの上限切れ） |

同じ Android ラボをテキストで流した比較:

| ケース | テキスト | XML |
|---|---|---|
| red-green | 成功 8ステップ | 失敗 13（上限切れ。途中で戻るキーによりアプリ外へ出た） |
| blue-yellow | 成功 8 | 成功 12 |
| presbyopia | 成功 8 | 失敗 13（上限切れ） |
| low-vision | 成功 12 | 成功 7 |

失敗はどちらも「Quick actions」画面（アイコンボタン24個）で起きた。この画面のXMLは約2万文字あり、
モデルは `ref="58"`（`resource-id="nextButton"`、`content-desc="Next button"`）が見えていながら、
Settings・Menu などのアイコンやその中の文字ノードを押し続けた。テキストでも同じ画面で1〜5ステップ迷ったが、
上限内に Next へ到達した。

# 言っていないこと

- **反復は各1回。** 差が再現するかは確かめていない。
- **XMLを短くした形式は試していない。** 既定値の属性を省くなどで量を減らした場合は別途計測が必要。
- **座標が役立つ画面は試していない。** 題材はすべて要素がノードとして取れる画面で、座標でしか操作できないUIは含まない。
- **他モデルは試していない。** 26B-A4B QAT のみ。

[^runs]: ダッシュボードの run 詳細（ステップごとの操作・UIテキスト・判定理由）と `just launch-all` のサーバーログ。
