---
type: Measurement
title: Gemma 4 の実モデル Web E2E 比較
description: >-
  実Genkit・Chrome・画面操作を通してログインと購入の4ケースを比較する。
  依頼16モデルと対照2モデルの72ケースを実測し、最終画面も照合した。
status: stable
tags: [llm, tool-calling, measurement]
generated: { by: codex, at: 2026-09-27T02:48:23.340612+00:00 }
verified:
  - { by: process:android-final-report-check, at: 2026-09-26T20:03:11.100323+00:00 }
  - { by: process:web-e2e-matrix, at: 2026-09-26T16:38:00Z }
  - { by: process:final-evidence-audit, at: 2026-09-26T17:45:19+00:00 }
stale_after: 2027-03-26T00:00:00Z
sources:
  - id: raw
    resource: ../bench/e2e/results/
    title: モデル別の完全なrun JSON、シナリオ、ロード設定、モデル出力、集計
    author: process:web-e2e-matrix
  - id: fixture
    resource: ../bench/e2e/fixtures.json
    title: 既存loginとshopの4ケースを転記した入力
    author: human:kexi
  - id: harness
    resource: ../bench/e2e/run.py
    title: API実行と最終UI要素の独立した照合
    author: process:web-e2e-matrix
  - id: artifacts
    resource: ../var/model-e2e-20260927/
    title: 実画面のPNG・動画・サーバーNDJSONログ
    author: process:web-e2e-matrix
  - id: environment
    resource: ../bench/e2e/results/environment.json
    title: 実行環境と生成条件
    author: process:web-e2e-matrix
---

Gitには集計・監査記録を保存し、端末依存の生証跡はローカルに保持する。clone先で原本を再照合する際の条件は[証跡の保存範囲](../bench/README.md)を参照。

# 範囲と条件

**依頼16モデルと対照2モデルのWeb E2E、計72ケースを実行した。**
4/4だったのは、31Bの全5構成、26B QATのMLX/GGUF、12B MLX 5bit、
12B QAT GGUF、E4B QAT GGUFの計10構成。
E4B/E2B MLXに加え、Tool Call単体45/45だった12B MLX 6bit / 8bitにも
終了判断の失敗が出た。Android実機の測定は含まない。[^raw]

既存の `login.web.yaml` と `shop.web.yaml` を合わせた4ケースを、モデルごとに1回ずつ実行した。
正常ログイン、誤パスワード表示、Yirgacheffeのカート合計$18.00、確認コード付き注文を対象とする。
各ケースのプロンプトと上限15/15/20/30ステップは元fixtureのまま。
専用シナリオを使い、開始前に入力・対象・モデルを検査する。[^fixture][^harness]

Headless Chrome 153.0.8010.53上のローカル検証アプリを、
本番の `GenkitLlm` → LM Studio → `CdpClient` → 次画面取得という経路で操作する。
ケースごとにブラウザーコンテキストを新しくする。
スクリーンショットと動画を保存し、Firestoreエミュレーターの結果をJSONへ書き出す。
モデル推論をモックした単体テストや、モデル一覧APIの疎通試験とは区別する。[^raw][^artifacts]

モデルはDOMから得たUIテキストを入力として受け取る。画像レビューは無効。
生成設定と最大3回の再試行はアプリの既定を保つ。
temperature・reasoning_effort・max_tokensは明示しない。
compat-oai 1.40.1はGenkitのtoolChoiceをHTTPへ転送しないため、
直接APIのTool Callベンチ（temperature=0、tool_choice=required、再試行なし）とは条件が異なる。
さらに実GenkitLlmのfetchを遮断して送信bodyを調べたところ、HTTPの各toolからdescriptionも欠落した。
system prompt内の操作説明は残る。これらは既存アプリ経路の観測であり、今回の試験中は修正していない。
保存した `genkit-wire-probe.json` は送信形状の検査であり、モデル推論成功数には加算しない。[^environment]

Android実機は接続されておらず、既存AVDもなかったため、今回の新規E2EはWeb版で実行した。
Android実機の完走結果としては扱わない。
過去SQLite履歴にはモデル名がなく、今回のモデル別成績には加算しない。[^environment]

後続の[AndroidエミュレーターE2Eとメモリ計測](gemma-android-e2e-model-matrix-2026-09.md)は別実行として記録する。
本Web試験の実使用メモリは未計測であり、保存済みのモデルサイズやロード推定値を実測使用量として扱わない。

# 判定方法

LLMの `finish(passed)` だけを成功条件にしない。
最後のfinishステップの操作前UIを、安定した要素IDとtextの完全一致で照合する。
finishは画面遷移しないため、このUIは終了時の画面を示す。
入力欄に期待文字列を書いただけのケース、別ID、部分一致、重複IDは通さない。[^harness]

| ケース | 終了時に確認する表示 |
|---|---|
| 正常ログイン | screenTitle=Kexi Coffee Shop、Sign out、Yirgacheffeの商品行 |
| 誤パスワード | errorMessage=Invalid email or password |
| カート | screenTitle=Your cart、Yirgacheffe数量1、cartTotal=Total: $18.00 |
| 注文 | screenTitle=Order placed!、orderNumber=Order number: KCS-1001 |

自己判定passedとUI照合passedの両方を満たしたケースだけを検証済み成功とする。
finishがなければUI照合はunavailableであり、成功には数えない。
全体期限は1モデル900秒。期限超過時は部分結果を保存し、
サーバー上で実行が続いている間はモデルを切り替えない。[^harness]

# 完了した結果

| モデル | 正常ログイン | 誤パスワード | カート | 注文 | 成功数 | 合計時間 | 操作数 | 失敗したLLM試行 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 12B MLX 5bit | 成功 | 成功 | 成功 | 成功 | 4/4 | 142.983秒 | 34 | 0 |
| 12B MLX 6bit | 成功 | failed | 成功 | 成功 | 3/4 | 145.877秒 | 37 | 0 |
| 12B MLX 8bit | 成功 | failed | 成功 | 成功 | 3/4 | 131.968秒 | 37 | 0 |
| 12B QAT GGUF Q4_0 | 成功 | 成功 | 成功 | 成功 | 4/4 | 233.882秒 | 27 | 0 |
| 26B-A4B QAT GGUF Q4_0 | 成功 | 成功 | 成功 | 成功 | 4/4 | 99.475秒 | 25 | 0 |
| 26B-A4B QAT MLX 4bit（対照） | 成功 | 成功 | 成功 | 成功 | 4/4 | 105.810秒 | 25 | 0 |
| 31B MLX 4bit | 成功 | 成功 | 成功 | 成功 | 4/4 | 193.276秒 | 25 | 0 |
| 31B MLX 5bit | 成功 | 成功 | 成功 | 成功 | 4/4 | 256.321秒 | 25 | 0 |
| 31B MLX 6bit | 成功 | 成功 | 成功 | 成功 | 4/4 | 283.291秒 | 25 | 0 |
| 31B MLX 8bit | 成功 | 成功 | 成功 | 成功 | 4/4 | 249.293秒 | 25 | 0 |
| 31B QAT GGUF Q4_0 | 成功 | 成功 | 成功 | 成功 | 4/4 | 474.808秒 | 25 | 0 |
| E2B MLX 4bit | error | error | error | error | 0/4 | 10.475秒 | 0 | 12 |
| E2B MLX 8bit | failed | failed | failed | failed | 0/4 | 89.644秒 | 80 | 0 |
| E4B MLX 4bit | 成功 | 成功 | 成功 | failed | 3/4 | 86.153秒 | 22 | 0 |
| E4B MLX 5bit | 成功 | error | error | error | 1/4 | 107.616秒 | 39 | 9 |
| E4B MLX 6bit | error | error | error | error | 0/4 | 61.149秒 | 31 | 12 |
| E4B MLX 8bit（対照） | 成功 | error | error | error | 1/4 | 101.732秒 | 39 | 9 |
| E4B QAT GGUF Q4_0 | 成功 | 成功 | 成功 | 成功 | 4/4 | 93.687秒 | 25 | 0 |

自己判定だけで通したケースはない。成功は終了UIの照合を含む。
errorは有効な操作を得られず例外終了、failedはステップ上限またはモデルの失敗判定。
失敗したLLM試行数は最初の失敗も含み、「再試行回数」そのものではない。
正解画面に到達してもfinishを返せなければE2E完走には数えない。[^raw]

26B QAT MLX対照は正常ログイン18.631秒、誤パスワード17.716秒、カート25.097秒、注文44.366秒。
注文でコード4821をrememberへ保存し、入力して注文番号表示まで到達した。
31B MLX 4bitは同じ4/4で193.276秒、26B対照は105.810秒、26B QAT GGUFは99.475秒。
今回の4ケースでは31Bの信頼性優位は観測できず、4bitの所要時間は26B対照の約1.83倍だった。
単発・固定順序の測定であり、量子化やランタイムだけの速度差とは断定しない。[^raw]

# 失敗の内訳

12B MLX 6bit / 8bitは誤パスワードで、正しいエラー表示が出た後もLoginを押し続け、
15ステップ上限で失敗した。6bitの最終PNGにも期待したエラーが表示されている。
5bitは4/4を完走したが、34操作と26B・31Bの25操作より多かった。
Tool Call単体45/45でも、履歴を伴う終了判断まで保証できない。
同じ量子化を繰り返したE2Eではないため、量子化が原因であるとは断定しない。[^raw][^artifacts]

**E4B QAT GGUFは4/4成功、失敗したLLM試行は0回。**
Tool Call単体の35/45と矛盾するものではない。入力画面・履歴・HTTP生成条件が異なる。
小型モデル全体を「E2Eが動かない」とはまとめられない。[^raw]

E4B MLX 4bitは3/4。注文ではコード4821が見えていた画面でrememberを使わず次へ進み、
確認入力画面で「コードが分からない」と `finish(failed)` を返した。
これは形式エラーではなく、必要な情報を保持しなかったための失敗である。[^raw]

E4B MLX 5bitも1/4。誤パスワードとカートはTool Call 0件による3試行失敗、
注文はrememberを省略した後に待機・スクロール・空欄での注文操作を行い、
架空の123456を繰り返し入力して27操作後に形式エラーになった。[^raw]

E4B MLX 6bitは0/4。ログイン・誤パスワード・カートの到達後に終了Tool Callを返せず、
それぞれ3試行でerrorとなった。注文もrememberを省略し、123456を繰り返し入力して
20操作後に形式エラー。合計12回の失敗試行があり、再試行による回復はなかった。[^raw]

E4B MLX 8bit（対照）は1/4。
誤パスワードとカートではモデル入力ログに期待した表示があり、画面目標には到達していた。
しかし終了を `finish{...}` / `finish(...)` と区切り無しで出力し、3試行ともTool Callにならなかった。
注文ではrememberを呼ばずコード画面を離れ、待機・スクロールの後に架空の123456を繰り返し入力した。
27操作後に形式失敗で終了した。保存PNGでもコード欄の繰り返し入力を確認した。[^raw][^artifacts]

E2B MLX 4bitは全4ケースで最初の判断が3回ともTool Call 0件となり、操作前にerror。
E2B MLX 8bitは80操作を返し、形式の再試行は0回だったが、同じ入力・タップを繰り返した。
15/15/20/30のステップ上限に達して全4ケースfailed。
注文ケースの最後のPNGにも、メールの反復入力と空のパスワード欄があり、Sign in画面のままだった。
**形式が通ることと、目的に沿って複数手順を完遂できることは別である。**[^raw][^artifacts]

誤パスワード・注文の26B対照PNG、E4B QAT GGUFの注文成功PNG、E4B/E2B MLXの注文失敗PNG、12B MLX 6bitの誤パスワードPNGを目視した。
その他の画面は保存UI文字列の機械照合であり、全PNG・動画を目視したわけではない。
確認対象を `bench/e2e/results/visual-checks.json` に記録した。[^artifacts]

# 証跡と検証

`aggregate.json` を完全なrun JSONから再集計し、`evidence-audit.json` で依頼16構成と
対照2構成の重複・欠落がないこと、全72ケースが終了していることを確認した。
記録されたスクリーンショット546枚、動画72本はすべて存在する。
E2B 4bitの4ケースは最初の判断前に失敗したため、操作スクリーンショットは0枚。
LLMログの帰属不能イベントは0件で、失敗42試行はいずれも再試行で回復しなかった。[^raw][^artifacts]

実画面の例：
[成功したE4B GGUFの注文](../var/model-e2e-20260927/screenshots/ff4b775c-a554-4fb8-9694-67cbfbfccb19/checkout-with-code/010.png)、
[E4B MLX 8bitのコード反復入力](../var/model-e2e-20260927/screenshots/b039de70-4812-4563-96de-32e9d7e24a9d/checkout-with-code/026.png)、
[E2B MLX 8bitのログイン停滞](../var/model-e2e-20260927/screenshots/a0b1471e-051c-4c2d-9133-c2efed83f918/checkout-with-code/029.png)、
[12B MLX 6bitの終了判断失敗](../var/model-e2e-20260927/screenshots/b5eb6b07-474d-4cb1-ac64-1c9e4aa3d0c9/invalid-password/014.png)。

ベンチのRuff lint・整形・Python構文検査は通過した。
Gitleaksは終了コード1で88件を検知したが、すべて公開モデル名2種のkey値だった。
該当行を照合し、検知ルールは変更していない。詳細は `verification.json` に保存した。
計測後はモデルをアンロードし、今回起動した検証用プロセスを停止した。[^raw]

# 制限

- 各モデル4ケースを1回ずつ実行するスモーク試験であり、一般的な完走率や反復安定性は推定できない。
- 対象はローカルの固定fixture。未知のアプリ、実サービス、Android実機での成功を保証しない。
- 所要時間はケース開始から終了までで、モデルのダウンロード・ロード時間を含まない。
  失敗して早く終了した時間も含むため、成功数が異なる構成の完走速度として比較しない。
  実行順・機体温度・キャッシュを統制した反復測定ではない。
- UI照合は対象画面の到達確認であり、アプリ内すべての要件を検証したものではない。

[^raw]: `bench/e2e/results/`。各runの完全なJSONとモデルロード情報。
[^fixture]: `bench/e2e/fixtures.json`。元の `scenarios/login.web.yaml` と `shop.web.yaml` の4ケース。
[^harness]: `bench/e2e/run.py`。固定IDと表示文字列を照合し、自己判定と分けて保存する。
[^artifacts]: `var/model-e2e-20260927/`。PNG・動画・サーバーログはリポジトリの規約に従いvarへ保存する。
[^environment]: `bench/e2e/results/environment.json`。環境と生成条件。
