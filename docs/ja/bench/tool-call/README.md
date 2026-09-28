# Gemma Tool Call 比較

English: [../../../../bench/tool-call/README.md](../../../../bench/tool-call/README.md)

資料リポジトリ `gemma-meetup-2026/bench/tool-call` の9ケースを使う。
`fixtures.py` の入力・期待操作と `tools.json` は元のベンチから転記した。
現行 `packages/agent/src/llm.ts` の system prompt と7ツールにも一致する。

```sh
lms load <model-key> --identifier <benchmark-id> --context-length 8192 --parallel 1 -y
python3 bench/tool-call/run.py --model <benchmark-id>
```

- `temperature=0`, `tool_choice=required`、最大出力トークンは未指定。
- tapを1回ウォームアップした後、9ケースを各5回、逐次実行する。
- 正解は「tool callが1件、引数がスキーマ適合、期待する操作、finish_reason=tool_calls」を全て満たすこと。
- `results/` に完全なリクエスト・API応答、設定、集計を保存する。ウォームアップは集計対象外。
- `--context-length 8192` を指定しても、今回のMLXは別の長さを報告した。E2B/E4Bは131072、12B/26Bは262144、31Bは量子化ごとのauto-fit値である。指定値と実ロード値を記録し、コンテキスト長が完全に一致したとは扱わない。並列1は実際の値を検査する。
- 応答時間は同じ入力の反復とキャッシュを含む。純粋な生成速度、独立した45問題の正答率、実機E2Eの完走率ではない。
- 全応答の中央値と成功時のみの中央値を分ける。成功ケースが異なるモデル同士の中央値を単純に順位付けしない。
- アプリのGenkit経路は再試行するが、この計測はAPIへ直接送り再試行しない。本文からのtool call復元も行わない。
- 本番操作経路はtemperature未指定。またcompat-oai 1.40.1はGenkitのtoolChoiceをHTTPへ転送しないため、このベンチの明示的なtool_choice=required/temperature=0とはHTTP設定が異なる。
- `--reasoning-effort none|low` は診断用の明示制御。`low` はGemmaのboolean toggleではONを意味する。モデルが制御非対応なら無視され得るため、応答のreasoningと入力ログでも確認する。
- `--max-tokens` / `--cases` / `--trials` で診断を絞れる。通常の45回比較と、上限付き診断の成績は別に扱う。

`model-configs/` は取得済みの同じMLX重みへthinking制御だけを追加する検証用の別名定義。
LM Studioの `models/bench/<名前>/model.yaml` として登録する。既存のモデル定義を変更しない。

`run_controls.py` は別名定義を登録した後に使う診断用スクリプト。
E4B MLX 8bitのnone / low、E4B QAT GGUFのnone、31B MLX 4bitのlow、
26B-A4B QAT MLX 4bitのlow、26B-A4B QAT GGUFのlowをこの順で逐次実行する。
全条件で `max_tokens=1024` を指定し、通常は9ケース×1回。
E4B QAT GGUFのnoneだけは `finish_failed` / `wait` / `key_back` を各1回測る。
通常16モデル×45回の本試験に追加する、推論モードの切り分けを目的とした診断である。
各ケース1回のため、速度比較は補助観測に限定する。
識別子を `bench-control-` で始め、通常比較の結果と区別する。
1条件が例外で失敗しても残りを実行し、最後に終了コード1を返す。

```sh
python3 bench/tool-call/run_controls.py
python3 bench/tool-call/run_controls.py --only e4b-mlx-8bit-none e4b-mlx-8bit-low
```

`--only` で複数条件を選んだ場合も、実行順は上記の順序を保つ。

`download_matrix.py` は今回の追加13モデルを外付けSSDの専用ディレクトリへ取得する補助スクリプト。
取得先とモデル一覧はファイル冒頭に記載。Hugging Faceのrevisionを保存して固定する。
最優先の3モデルは個別取得した。26B-A4B QAT MLXとE4B MLX 8bitを対照として計測した。
12B MLX 4bitは今回の計測対象に含めない。

GGUFとMLXの配布モデルは同じ系列でも量子化・変換・テンプレートの差がある。
APIの成否だけで「ランタイムのパーサだけが原因」とは結論しない。

`results/diagnostics/` はロード失敗などの予備診断であり、モデル比較の集計から除外する。
