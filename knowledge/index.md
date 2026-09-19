---
okf_version: "0.2"
---

# ナレッジ索引

このリポジトリで調査・計測して分かったことを OKF v0.2 で記録する。
着手前にここを見て、既知の知見と過去の誤りを踏まえてから作業する。

## LLM

* [MLX 版 Gemma 4 の tool call 安定性](gemma-tool-calling.md) - LM Studio 0.4.24 + MLX の gemma-4-26b-a4b-qat は tool_calls を安定して返す。「MLX 系 Gemma の tool-call パーサは信用できない」という以前の前提は、この構成では成り立たなかった。
