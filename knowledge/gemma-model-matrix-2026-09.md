---
type: Measurement
title: Gemma 4 の量子化・ランタイム別 Tool Call 比較
description: >-
  依頼16モデルと対照2モデルで同じ9ケースを各5回実行。
  12B・26B・31Bは45/45、E4B/E2Bには形式・操作判断の失敗が残る。
  31B MLXの実ロードコンテキスト長の記述を2026-09-27に訂正。
status: stable
tags: [llm, tool-calling, measurement]
generated: { by: codex, at: 2026-09-27T02:48:23.340612+00:00 }
verified:
  - { by: process:tool-call-matrix, at: 2026-09-26T15:12:00Z }
  - { by: codex, at: 2026-09-26T16:31:13Z }
  - { by: codex, at: 2026-09-26T17:07:37+00:00 }
  - { by: process:final-evidence-audit, at: 2026-09-26T17:45:19+00:00 }
  - { by: process:loaded-context-audit, at: 2026-09-26T18:09:13.247904+00:00 }
stale_after: 2027-03-26T00:00:00Z
sources:
  - id: raw
    resource: ../bench/tool-call/results/
    title: リクエスト・応答全文、モデル出力ログ、ロード設定、配布revision
    author: process:tool-call-matrix
    last_modified: 2026-09-26T15:12:00Z
  - id: fixture
    resource: ../bench/tool-call/fixtures.py
    title: 元資料の9ケースと正解判定
    author: human:kexi
  - id: aggregate
    resource: ../bench/tool-call/results/aggregate.json
    title: 本試験18runと追加診断5runの再集計（診断は別集計）
    author: process:tool-call-matrix
  - id: implementation
    resource: ../packages/agent/src/llm.ts
    title: 現行の7ツールとsystem prompt、Tool Call専用のGenkit経路
    author: human:kexi
  - id: provenance
    resource: ../bench/tool-call/results/provenance-audit.json
    title: 配布revision・取得メタデータ・実サイズの照合
    author: process:tool-call-matrix
---

Gitには集計・監査記録を保存し、端末依存の生証跡はローカルに保持する。clone先で原本を再照合する際の条件は[証跡の保存範囲](../bench/README.md)を参照。

# 計測範囲

**依頼16モデルと対照2モデル、全18構成の本試験を完了した。**
9ケース×5回、計810試行。推論モードを制御した追加診断は下段に分ける。[^aggregate]

資料リポジトリ `gemma-meetup-2026` の commit
`31436c4294c99f6c65bd8f704ff767a1ea08f65f` にある
`bench/tool-call/run.py` の9ケースを使用した。
現行アプリの commit `b705c2e44bc735493103ca551c4523b2caa991af` の
`actionTools()` / `SYSTEM_PROMPT` をBunとGenkitで生成し、
保存した `tools.json` と完全一致することを確認した。
入力・期待値は元スクリプトとASTおよび実行時データの比較で確認した。[^fixture][^implementation]

合成UIテキストから次の1操作を選ぶ **Tool Callのみ** の試験である。
画像入力、実機E2E、アプリのGenkit経由の再試行、マルチターンのtool結果往復は測っていない。
本文をJSONとして復元するフォールバックは使用していない。[^raw]
実モデルE2Eは[別レポート](gemma-e2e-model-matrix-2026-09.md)に記録し、この文書の結果には含めない。

# 条件

| 項目 | 設定・観測値 |
|---|---|
| ホスト | Mac14,5 / Apple M2 Max / 96GB / macOS 27.0 |
| LM Studio | 0.4.24+1 |
| ランタイム | MLX 1.11.0 / llama.cpp 2.41.0 |
| エンドポイント | localhost:1234/v1/chat/completions |
| sampling | temperature=0、最大出力トークン未指定 |
| tools | 現行アプリと同じ7ツール、tool_choice=required |
| 試行 | tapのウォームアップ1回を除外し、9ケース×5回、再試行なし |
| 並列 | ロード設定1、リクエストも逐次 |
| context | 8192を指定。GGUFは8192。MLXはE2B/E4Bが131072、12B/26Bが262144、31Bは4/5/6/8bitの順に261120/243968/226816/192512 |
| 速度 | 同一入力を連続反復したキャッシュ込みのHTTP応答時間。ダウンロードとE2E環境準備が並行した参考測定 |

**2026-09-27訂正**：旧記述「MLXはAPI上131072/262144を報告」は31Bの値を省略しており不正確だった。
`bench/tool-call/results/bench-31b-it-mlx-*.loaded.json` とWeb E2Eのロード記録を照合し、
上表を実ロード値へ訂正した。MLXのcontext auto-fitログも31Bの各値と一致する。[^raw]

context指定と実際の報告値をmetadataへ保存した。
モデル間のコンテキスト長が完全に揃ったとは主張しない。
45試行は **45種類の独立した課題ではない**。
同じ9課題の反復なので、未見の画面に対する一般的な成功率は推定できない。[^raw]

# 完了した計測

正解は「Tool Callが1件」「引数がスキーマ適合」「期待した操作」「finish_reasonがtool_calls」の全条件。
速度は成功時のみの中央値であり、成功ケースが違うモデル同士の単純な順位付けには使わない。[^raw]

| モデル | 1件のTool Call | 引数適合 | 操作まで正解 | reasoningを返した回数 | 成功時中央値 |
|---|---:|---:|---:|---:|---:|
| 26B-A4B QAT MLX 4bit（対照） | 45/45 | 45/45 | 45/45 | 45/45 | 3.787秒 |
| E4B MLX 8bit（対照） | 30/45 | 30/45 | 25/45 | 0/45 | 2.430秒 |
| E4B QAT GGUF Q4_0 | 45/45 | 45/45 | 35/45 | 45/45 | 5.497秒 |
| 31B MLX 4bit | 45/45 | 45/45 | 45/45 | 0/45 | 7.673秒 |
| 26B-A4B QAT GGUF Q4_0 | 45/45 | 45/45 | 45/45 | 45/45 | 4.749秒 |
| 31B MLX 5bit | 45/45 | 45/45 | 45/45 | 0/45 | 9.003秒 |
| 31B MLX 6bit | 45/45 | 45/45 | 45/45 | 0/45 | 6.199秒 |
| 31B MLX 8bit | 45/45 | 45/45 | 45/45 | 0/45 | 4.696秒 |
| 31B QAT GGUF Q4_0 | 45/45 | 45/45 | 45/45 | 45/45 | 12.024秒 |
| 12B MLX 5bit | 45/45 | 45/45 | 45/45 | 0/45 | 1.556秒 |
| 12B MLX 6bit | 45/45 | 45/45 | 45/45 | 0/45 | 1.690秒 |
| 12B MLX 8bit | 45/45 | 45/45 | 45/45 | 0/45 | 1.939秒 |
| 12B QAT GGUF Q4_0 | 45/45 | 45/45 | 45/45 | 45/45 | 4.461秒 |
| E4B MLX 4bit | 25/45 | 25/45 | 15/45 | 0/45 | 1.907秒 |
| E4B MLX 5bit | 25/45 | 25/45 | 20/45 | 0/45 | 1.163秒 |
| E4B MLX 6bit | 30/45 | 30/45 | 25/45 | 0/45 | 1.133秒 |
| E2B MLX 4bit | 5/45 | 5/45 | 5/45 | 0/45 | 0.516秒 |
| E2B MLX 8bit | 15/45 | 15/45 | 15/45 | 0/45 | 0.662秒 |

18runはすべて9ケース×5回の本試験で、上限付きの追加診断は混ぜていない。
表の全数値を `aggregate.json` と照合し、E4B/E2Bの失敗内訳は各JSONLの
操作名・引数・本文を確認した。reasoning列はAPI応答にreasoningが含まれた回数であり、
内部計算の有無を直接証明するものではない。[^aggregate][^raw]

26B-A4B QATはMLX/GGUFとも45/45であり、この試験ではパーサ不良を示す差は出なかった。
両形式の保存リクエストはmodel名以外同一だった。
GGUFのモデル出力ログはウォームアップ込み46件で正式なtool区切りを確認した。
MLX対照の生トークンログは取得開始前であり、API応答の正常性のみ確認できる。
31B MLX 4bit / 5bit / 6bit / 8bit、31B QAT GGUF、12B MLX 5bit / 6bit / 8bit、12B QAT GGUFも45/45だった。
この9課題では31Bが26Bより確実とはいえない。
31B 8bitの中央値が4bitより短いことも、並行作業やreasoning・キャッシュの影響を
統制した量子化別速度比較とは扱わない。[^aggregate]

## E4Bの本文漏れ3ケース

MLX 8bitでは `finish_failed` / `wait` / `key_back` がそれぞれ0/5、
QAT GGUFでは全て5/5になった。
ただし、GGUFの `remember` は0/5（記憶せず画面遷移）、
`swipe` は0/5（指示ではupが正解だがdownを選ぶ）。
MLXも今回の `remember` は0/5で、形式は正しいtapを返した。[^raw]

モデル出力ログでは、MLXの成功したtapは
`<|tool_call>call:tap{ref:1}<tool_call|>` という区切りを含む。
失敗したwaitは `wait{}`、失敗終了は `finish(verdict=...)` と生成されており、
API応答だけでなくモデル出力側でも形式が違った。
`wait{}` は必須引数msも欠くため、単に本文から抽出しても有効な操作にはならない。[^raw]

## E4B / E2Bの具体的な失敗ケース

以下の失敗ケースはそれぞれ0/5だった。形式失敗はAPIに1件のTool Callが無い状態、
操作誤りは形式と引数スキーマを満たすが期待操作と異なる状態を指す。[^raw]

| モデル | 形式失敗 | 形式は適合したが操作を誤ったケース |
|---|---|---|
| E4B MLX 4bit | `wait`、`swipe`、`key_back`、`long_screen` | `finish_passed` と `remember` で `tap(ref=0)` |
| E4B MLX 5bit | `finish_passed`、`finish_failed`、`wait`、`key_back` | `remember` で `tap(ref=0)` |
| E4B MLX 6bit / 8bit | `finish_failed`、`wait`、`key_back` | `remember` で `tap(ref=0)` |
| E4B QAT GGUF | なし | `remember` で `tap(ref=0)`、`swipe` で `down` |
| E2B MLX 4bit | `tap`、`input_text`、`finish_passed`、`finish_failed`、`remember`、`wait`、`swipe`、`key_back` | なし（`long_screen` のみ5/5） |
| E2B MLX 8bit | `finish_passed`、`finish_failed`、`remember`、`wait`、`swipe`、`key_back` | なし（`tap`、`input_text`、`long_screen` は各5/5） |

E4B 4bitの `long_screen` は正しいrefを含む `tap{ref:47}` が本文に出たが、
構造化Tool Callにならなかった。5bitの `finish_passed` / `finish_failed` / `wait` は
少なくとも第1試行で本文も空で、本文漏れだけでは失敗全体を説明できない。
E2B 4bitの `tap` は `tap{ref:1}`、`remember` は `tap:ref=0` という本文だった。
E2Bの成功した操作だけの短い中央値は、汎用的なE2E速度・完走性能を意味しない。[^raw]

# 因果関係の制限

- E4B MLX 8bitとQAT GGUFは、量子化・QAT・既定のreasoningが同時に異なる。
  GGUFで改善した事実だけから「MLXのパーサが原因」とは断定できない。
- 26B-A4BのQAT MLXとQAT GGUFも同じ系列の配布モデル比較であり、
  配布元READMEだけでは元checkpointのrevision一致を保証できなかった。
- 推論モード追加診断は各ケース1回のみで、本試験45回と同じ精度の比較ではない。
- 本番と同じsystem prompt・ツール定義を使うが、HTTP設定まで同一ではない。
  本番操作経路はtemperature未指定で、GenkitのtoolChoiceを指定している。
  インストール済みcompat-oai 1.40.1はそれをHTTPのtool_choiceに転送しない。
  HTTPのtool descriptionも実Genkit経路では欠落する（`bench/e2e/results/genkit-wire-probe.json`）。
  今回は直接APIでdescriptionを保持し、tool_choice=required、temperature=0を明示した。
  この差と再試行の有無があるため、アプリ全体の動作保証には置き換えられない。[^implementation]

# 重みの来歴

31B MLX 4bitと26B QAT GGUFは、配布元メタデータとHF取得記録のrevision・
期待ハッシュ・実ファイルサイズを照合した。E4B QAT GGUFも取得記録のrevisionが一致した。
巨大な重みを全量再ハッシュしたわけではない。
既存26B QAT MLX対照はLM Studioの完了済み取得記録と実サイズを確認したが、
取得URLがmain参照でrepo commitは確定できなかった。
その他の追加モデルは取得時の配布SHAを固定し、source/download JSONへ保存した。[^provenance][^raw]

今回の取得再試行では配布sourceを変更せずに復旧した。
12B MLXは取得後もHub別名（例: `google/gemma-4-12b@5bit`）で
`Model not found` となった。隔離したローカルsymlinkを登録し、
CLIの `gemma-4-12b-it-mlx-bench@5bit` 等でロードして3構成とも45/45を完了した。
フルindexedModelIdentifierでもCLIは解決しなかった。これらは推論前のロード失敗なので
モデルのTool Call不正解に加算していない。[^raw]

# 推論モードを制御した追加診断

各ケース1回、temperature=0、max_tokens=1024。MLXの同じ重みとパーサ設定を使い、
`enableThinking` を公開する専用model.yaml経由で `reasoning_effort=none/low` を指定した。
Gemmaのこの設定ではlowがthinking有効を表す。成功時中央値は参考値。[^raw]

| 構成 | 推論設定 | Tool Call 1件 | 操作まで正解 | 成功時中央値 |
|---|---|---:|---:|---:|
| 31B MLX 4bit | low | 9/9 | 9/9 | 13.537秒 |
| 26B-A4B QAT MLX 4bit | low | 9/9 | 9/9 | 3.310秒 |
| 26B-A4B QAT GGUF | low | 9/9 | 9/9 | 2.786秒 |
| E4B MLX 8bit | none | 6/9 | 5/9 | 1.078秒 |
| E4B MLX 8bit | low | 8/9 | 6/9 | 3.560秒 |

E4B MLX 8bitはlowでfinish_failedとkey_backの形式が改善した。
ただしwaitは `wait{ms:2000}` が本文に出てTool Callにならず、rememberはtap、
swipeはdownを選んだ。推論モードは結果に影響するが、有効化だけで全件正常にはならない。[^raw]

E4B QAT GGUFのnone診断はウォームアップでHTTP 400となった。
エラー本文は `The model produced output that does not match the expected peg-gemma4 format`。
予定した本文漏れ3ケースは実行されず、0/3とも成功とも扱わない。
このエラーは出力とランタイム期待形式の不一致を示すが、パーサ単独の欠陥を証明しない。[^raw]


[^raw]: `bench/tool-call/results/`。`aggregate.json` が完了runの再集計、各JSONLがリクエストとAPI応答、`model-log.jsonl` 等がモデル入出力ログ。`diagnostics/` のロード失敗は比較対象外。
[^fixture]: `bench/tool-call/fixtures.py`。元資料の入力と期待値を保持。
[^implementation]: `packages/agent/src/llm.ts`。本番のGenkit経路はtoolChoice=required、1件のTool CallだけをActionSchemaで検証する。
[^provenance]: `bench/tool-call/results/provenance-audit.json`。現在の重みの全量SHA256検証や、異なる形式の数値的同一性を示すものではない。
[^aggregate]: `bench/tool-call/results/aggregate.json`。本試験18run（810試行）と追加診断5run（45試行）を条件別に記録。失敗したウォームアップは含めない。
