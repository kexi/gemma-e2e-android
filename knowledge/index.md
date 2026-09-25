---
okf_version: "0.2"
---

# ナレッジ索引

このリポジトリで調査・計測して分かったことを OKF v0.2 で記録する。
着手前にここを見て、既知の知見と過去の誤りを踏まえてから作業する。

## LLM

* [スクショとペルソナによる視覚アクセシビリティレビュー](visual-accessibility-review.md) - Gemma への画像送信とペルソナ別出力を検証した。定性的な候補抽出であり、見え方の再現や適合判定ではない。

* [MLX 版 Gemma 4 の tool call 安定性](gemma-tool-calling.md) - LM Studio 0.4.24 + MLX の gemma-4-26b-a4b-qat は tool_calls を安定して返す。「MLX 系 Gemma の tool-call パーサは信用できない」という以前の前提は、この構成では成り立たなかった。
