# Directory Update Log

## 2026-09-27
* **Creation**: [Android E2Eとメモリ計測](gemma-android-e2e-model-matrix-2026-09.md) に18構成72ケース・49成功を記録。RSS 5125標本、footprint有効5081標本を再集計で検証。E4B MLX 4bitの途中報告3/4を原本に基づき2/4へ訂正し、録画6件欠落と保存動画の範囲制限も記録。
* **Update**: [Tool Call比較](gemma-model-matrix-2026-09.md) のMLXコンテキスト長を実ロードJSONで再照合し、31Bのauto-fit値を訂正。以前のWeb E2Eの使用メモリ実測は未採取であり、モデルのディスクサイズとGGUFロード推定値を `bench/e2e/results/memory-retrospective.json` に区別して保存。
* **Creation**: [実モデルWeb E2E比較](gemma-e2e-model-matrix-2026-09.md) に18構成・72ケースの成績、操作の反復・記憶漏れ・終了Tool Call失敗を記録。画面の独立照合と完全run JSONを保存。Android実機は未検証。
* **Creation**: [Tool Call比較](gemma-model-matrix-2026-09.md) に18構成・810試行と推論モード追加診断を記録。重みの取得元、生成条件、完了・未実行の区別を保存。
* **Update**: [以前のTool Call計測](gemma-tool-calling.md) の「toolChoiceがHTTPに反映される」という結論を、実Genkit送信bodyと互換層ソースの照合に基づき訂正。

## 2026-09-22
* **Update**: [視覚アクセシビリティレビュー](visual-accessibility-review.md) に操作順序、不正JSONの再試行、エラー保存サイズの不具合と回帰検証を追記。
* **Creation**: [視覚アクセシビリティレビュー](visual-accessibility-review.md) の画像入力、操作前証跡、検証範囲と実モデルの失敗例を記録。

## 2026-09-20
* **Creation**: [MLX 版 Gemma 4 の tool call 安定性](gemma-tool-calling.md) を追加。structured output から native tool call へ切り替えた際の計測。
