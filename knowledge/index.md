---
okf_version: "0.2"
---

# ナレッジ索引

このリポジトリで調査・計測して分かったことを OKF v0.2 で記録する。
着手前にここを見て、既知の知見と過去の誤りを踏まえてから作業する。

## LLM

* [画面をXMLで渡すとテキストより操作精度が落ちた](ui-tree-xml-vs-text-2026-09.md) - 全シナリオをXMLにすると8本中7本成功、Androidのアクセシビリティラボ（1ケース1ペルソナ）は2/4。同じシナリオはテキストで4/4。既定はテキストのまま。各1回の比較。

* [Gemma 4 の実モデル Android エミュレーター E2E とメモリ計測](gemma-android-e2e-model-matrix-2026-09.md) - Android API 35の専用AVDで4ケースを実行し、LM Studio関連プロセスのphysical footprintとRSSを採取する。18構成72ケースで49成功、10構成が4/4。モデル別メモリの標本最大値と欠測も記録した。

* [Gemma 4 の実モデル Web E2E 比較](gemma-e2e-model-matrix-2026-09.md) - 実Genkit・Chrome・画面操作を通してログインと購入の4ケースを比較する。依頼16モデルと対照2モデルの72ケースを実測し、最終画面も照合した。

* [Gemma 4 の量子化・ランタイム別 Tool Call 比較](gemma-model-matrix-2026-09.md) - 依頼16モデルと対照2モデルで同じ9ケースを各5回実行。12B・26B・31Bは45/45、E4B/E2Bには形式・操作判断の失敗が残る。

* [スクショとペルソナによる視覚アクセシビリティレビュー](visual-accessibility-review.md) - Gemma への画像送信とペルソナ別出力を検証した。定性的な候補抽出であり、見え方の再現や適合判定ではない。

* [MLX 版 Gemma 4 の tool call 安定性](gemma-tool-calling.md) - LM Studio 0.4.24 + MLX の gemma-4-26b-a4b-qat は tool_calls を安定して返す。「MLX 系 Gemma の tool-call パーサは信用できない」という以前の前提は、この構成では成り立たなかった。toolChoiceのHTTP転送に関する記述は2026-09-27に訂正した。
