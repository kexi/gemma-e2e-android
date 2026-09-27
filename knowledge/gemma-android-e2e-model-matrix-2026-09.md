---
type: Measurement
title: Gemma 4 の実モデル Android エミュレーター E2E とメモリ計測
description: >-
  Android API 35の専用AVDで4ケースを実行し、LM Studio関連プロセスのphysical footprintとRSSを採取する。
  18構成72ケースで49成功、10構成が4/4。モデル別メモリの標本最大値と欠測も記録した。
status: stable
tags: [llm, tool-calling, measurement]
generated: { by: codex, at: 2026-09-27T02:48:23.340612+00:00 }
verified:
  - { by: process:android-final-report-check, at: 2026-09-26T20:03:11.100323+00:00 }
  - { by: process:android-final-evidence-audit, at: 2026-09-26T19:59:11.245967+00:00 }
  - { by: process:android-evidence-read, at: 2026-09-26T18:28:03.326617+00:00 }
  - { by: process:memory-worker-coverage, at: 2026-09-26T18:23:31+00:00 }
  - { by: process:memory-gguf-worker-coverage, at: 2026-09-26T18:35:27.126868+00:00 }
stale_after: 2027-03-26T00:00:00Z
sources:
  - id: raw
    resource: ../bench/e2e/android-results/
    title: Android実行結果、モデルロード情報、メモリ生標本と集計
    author: process:android-e2e-matrix
  - id: fixture
    resource: ../bench/e2e/fixtures.json
    title: AndroidとWebの既存4ケースのプロンプト・対象・上限
    author: human:kexi
  - id: harness
    resource: ../bench/e2e/
    title: 逐次モデルロード、実API実行、終了UI照合、メモリ採取
    author: process:android-e2e-matrix
  - id: artifacts
    resource: ../var/model-e2e-android-20260927/
    title: Android APKビルド記録、AVD設定、preflight、画面証跡とサーバーログ
    author: process:android-e2e-matrix
  - id: memory-abi
    resource: ../bench/e2e/android-results/memory-footprint-verification.json
    title: ローカルSDKとCコンパイルによるABI確認、SIGTERM・取得失敗の検証
    author: process:memory-sampler-validation
  - id: worker
    resource: ../bench/e2e/android-results/memory-worker-coverage.json
    title: 実MLX推論workerのPID・ロード済みモジュールとメモリ標本の照合
    author: process:memory-worker-coverage
  - id: gguf-worker
    resource: ../bench/e2e/android-results/memory-gguf-worker-coverage.json
    title: GGUF推論worker・実モデルのmapped file領域・RSSとfootprintの照合
    author: process:memory-gguf-worker-coverage
  - id: footprint-definition
    resource: https://developer.apple.com/videos/play/wwdc2024/10173/
    title: Analyze heap memory — cleanとdirty/swappedのfootprint上の区別
    author: Apple
  - id: retrospective
    resource: ../bench/e2e/results/memory-retrospective.json
    title: 前回Web試験のメモリ未採取、ディスクサイズとロード推定値の区別
    author: process:memory-retrospective-audit
  - id: mlx8-audit
    resource: ../bench/e2e/android-results/memory-31b-mlx-8bit-audit.json
    title: 31B MLX 8bitのモデル一致・プロセス包含・生標本からの再計算
    author: process:memory-evidence-audit
  - id: wire
    resource: ../bench/e2e/results/genkit-wire-probe.json
    title: 実Genkit送信bodyと直接Tool Callベンチの生成条件差
    author: process:genkit-wire-probe
  - id: case-audit
    resource: ../bench/e2e/android-results/failure-analysis.json
    title: 全72ケースの操作履歴、成功条件、失敗原因、原本ハッシュの監査
    author: process:android-case-audit
  - id: memory-final
    resource: ../bench/e2e/android-results/memory-final-verification.json
    title: 全18構成のメモリ生標本からの再集計と計測時間範囲の照合
    author: process:memory-evidence-audit
  - id: recording
    resource: ../bench/e2e/android-results/recording-verification.json
    title: 録画ファイルの存在・動画ストリームと録画実装の確認
    author: process:recording-evidence-audit
---

Gitには集計・監査記録を保存し、端末依存の生証跡はローカルに保持する。clone先で原本を再照合する際の条件は[証跡の保存範囲](../bench/README.md)を参照。

# 範囲と測定状況

**18構成・72ケースのAndroidエミュレーターE2Eを完了し、49ケースの成功を確認した。**
依頼16構成と対照2構成を対象に、Androidエミュレーター上で各4ケースを1回ずつ実行した。
新しい実行の対象はAndroidアプリであり、[前回のWeb E2E](gemma-e2e-model-matrix-2026-09.md)の
成績をAndroidへ転記しない。Android実機や、端末上でGemmaを動かす試験ではない。
モデル推論はMac上のLM Studioで行う。[^raw][^fixture]

正常ログイン、誤パスワード、Yirgacheffeのカート合計$18.00、確認コード付き注文を対象とする。
元の `login.yaml` / `shop.yaml` に由来するプロンプトと15/15/20/30ステップ上限を保持する。
実行前に対象・ケース順・プロンプト・上限・明示モデルをfixtureと照合する。[^fixture][^harness]

# 確認した環境と経路

| 項目 | 条件・証跡 |
|---|---|
| 推論ホスト | Apple M2 Max / 96GB、LM Studioで1モデルずつ逐次実行 |
| Android | 専用AVD `gemma-e2e-bench-api35`、API 35、Google APIs、arm64-v8a、Pixel 7プロファイル |
| エミュレーター | 35.5.10.0、実起動設定4 CPU・RAM 3072 MiB・1080×2400 |
| 対象 | `dev.kexi.gemmae2e.example` / `.MainActivity` |
| APK | 現在のソースからarm64-v8a向けrelease variantをビルド。SHA-256等は `apk-build.json` |
| 操作経路 | 実 `GenkitLlm` → LM Studio → Android driver / `AdbClient` → UI再取得 |
| ケース初期化 | ケース開始時に対象アプリをforce-stopし再起動 |
| モデルロード | context=8192・parallel=1を指定し、実ロード値・量子化・モデルIDを保存・確認 |
| 保存 | 完全run JSON、シナリオ、モデルログ、画面・録画、メモリJSONL・summary |

AVDの `config.ini` にはRAM=2Gが残るが、実起動の `hardware-qemu.ini` は3072 MiB。
この数値は**仮想端末の設定値**であり、LM Studioの使用量にも、エミュレーターの実測RSSにも代用しない。
モデルロード時の実コンテキストは要求8192と一致しない場合があるため、各 `.loaded.json` を参照する。[^artifacts][^raw]

LLMを使わない決定的なAdbClient preflightで、正常ログイン、カート、コード表示、注文番号、
誤パスワードのUIを確認し、XML・UI文字列・PNGを保存した。
これは実アプリと操作経路の事前確認であり、モデルのE2E成功数には加算しない。[^artifacts]

AndroidはAccessibility由来のUI階層を入力とし、Web版のDOM/CDPとは取得経路と要素階層が異なる。
例えばSign outの表示テキストはAndroidではbuttonの子TextViewに存在する。
終了時の補助判定は安定IDと表示textの完全一致を使い、対象要素自身または必要な子孫を確認する。
入力欄の値・部分一致・全文検索を成功根拠にしない。[^harness][^artifacts]

# 生成条件と成功判定

アプリの生成設定を保持し、temperature・reasoning_effort・max_tokensは明示しない。
有効な操作を得られない場合の最大3試行もアプリ既定。
既存compat-oai 1.40.1の実送信bodyでは、Genkitに渡したtoolChoiceと各toolのdescriptionが欠落する。
system promptの操作説明は残る。直接APIで行ったTool Call単体試験の
temperature=0・tool_choice=required・再試行なしとは条件が異なる。[^wire]

自己判定 `finish(passed)` と終了UIの補助判定の両方を満たしたケースだけを検証済み成功とする。
finishは画面遷移しないため、最後のfinishステップの操作前UIを使う。
finishがなければ補助判定はunavailableであり、成功数には含めない。
画像レビュー機能は無効。PNGの存在確認・UI文字列の機械照合と、目視による画像確認は区別する。[^harness]

# メモリの定義

採取期間は**モデルロード完了後から、そのモデルの4ケース終了まで**。
ロード中のピークは含まない。1秒間隔でLM Studio関連プロセスとその子孫を取得する。
実行ファイルのパスとPPID関係で対象を識別し、単に名前に `mlx` などを含むという条件では選ばない。
LM StudioのUI・helper・推論workerは含み、Androidエミュレーター、APIサーバー、Firestoreは含まない。[^harness]

| 指標 | 定義 |
|---|---|
| physical footprint | macOS `proc_pid_rusage` / `RUSAGE_INFO_V0` の `ri_phys_footprint`、単位bytes |
| RSS | macOS `ps` のresident set size。出力の1024バイト単位をbytesへ変換 |
| 合計 | 各標本で対象プロセス群の値を合算。1PIDでもfootprint取得に失敗した標本のfootprint合計はnull |
| sampled peak | 計測期間内に採取できた標本の最大値。標本間の瞬間ピークは捉えない |
| median | 有効な標本に限った中央値。失敗・対象未検出を0に置換しない |

RSSは共有resident pageを重複計上し得る。physical footprintもカーネルのプロセス別会計であり、
プロセス群の合計をシステム全体の重複を除いた物理メモリ消費量とは呼ばない。
どちらもモデル単体のMetal allocator使用量・allocator peakとは異なる。
プロセスは順に読むため完全に同時のスナップショットではなく、UI/helperの使用量を差し引いていない。
表示をGBへ変換する場合は10^9 bytes、GiBなら2^30 bytesとして単位を明記する。[^harness]

`rusage_info_v0` はローカルmacOS SDKの `sys/resource.h` と `libproc.h` を確認し、
Cでsizeof=96、alignment=8、対象フィールドoffset=72、flavor=0を実行検証した。
ctypes構造体と一致し、戻り値0が成功、-1とerrnoが失敗。
SIGTERMで証跡を正常保存すること、存在しないPID・部分取得失敗がnullになることを検証した。[^memory-abi]

最初の26B-A4B QAT MLXロード後、実推論worker PID71904がLM Studio本体PID2264の子であり、
`llmworker.js` とMLX 1.11.0のエンジン・core・libmlxをロードしていることを読み取り確認した。
同PIDはsamplerの対象に含まれ、66標本時点でfootprint取得失敗は0件だった。
これはworker包含の確認であり、全モデルの計測完了や最終ピークを意味しない。[^worker]

GGUF側も26B QATの実worker PID79427、親PID2264を確認した。
実行ファイルは `llama.cpp-mac-arm64-apple-metal-advsimd-2.41.0/llama-server` で、
26B Q4_0.ggufとMetalランタイムが開かれており、samplerに同PIDが含まれる。
18:33:24 UTCの途中標本ではworkerのRSSが17.38 GB、footprintが2.86 GBだった。
プロセス群の合計もRSS 18.06 GBに対しfootprint 3.64 GBであり、最終ピークではない。[^gguf-worker]

`.loaded.json` / inventoryにはmmap設定値が保存されていなかったが、実workerの `vmmap -w` では
対象の26B Q4_0.ggufを指すread-onlyな `mapped file` 領域を直接確認した。
その領域はvmmap表記でサイズ・residentとも13.4G、dirty 0Kだった。
これは設定名からの推測ではなく、実際にファイルをメモリへマッピングしている観測である。[^gguf-worker]

Appleはcleanとdirty/swappedを区別し、アプリのfootprintには後者が計上されると説明している。
大きなclean mapped-file領域とRSS/footprintの差は、この会計上の違いと整合する。
**低いfootprintは、そのモデルが同じ小容量RAMで動くことを意味しない。**
結果にはRSSとfootprintの両列を残し、MLX/GGUFをまたぐ必要RAMの比較をfootprint単独で行わない。
両指標の単純加算や大きい方を取る操作も、重複のない総使用量にはならない。[^gguf-worker][^footprint-definition]

26B QAT MLX対照の終了記録はRSS 188/188標本、footprint 187/188標本が有効だった。
一時的な子プロセスbash PID74463がps取得後に終了し、footprint読取がerrno=3となった1標本は、
合計をnullのまま残し、footprintの中央値・標本最大値から除外した。
欠測した時間のfootprintは分からないため、187標本の最大値を連続計測の真のピークとは呼ばない。[^raw]

matrixの採取判定はRSS標本すべてが有効で、footprintの完全取得標本が1件以上あることを要求する。
欠測がある場合は明示的なイベントと有効標本数を残す。
最初の26B対照では全標本のfootprint取得を要求していたため、E2E終了・アンロード後に
matrixがエラー終了した。生ログで短命な子プロセスの終了による1標本の欠測と確認し、
上記の有効標本集計と欠測数明示へ変更した。保存済み188標本とE2Eの4/4結果は保持している。
一時プロセスの終了による欠測だけを理由に完了したE2Eを再実行して成績を置き換えない。
最終表ではfootprintの有効数/総数を併記し、全標本が得られた構成と区別する。[^harness][^raw]

**前回Web E2Eの実使用メモリは未計測**。
保存 `sizeBytes` はディスク上モデルサイズ、旧ログのload estimate / context-fit estimated_peakは推定値。
今回Androidで測った値を前回Web実行時の実測値として遡及使用しない。[^retrospective]

31B MLX 8bitではRSS最大15.91 GBに対してfootprint最大43.83 GBだった。
ロード情報と推論ログのモデル一致、対象の高メモリ子プロセスが314/314標本に存在すること、
単位変換・各標本の合計・中央値・最大値を再検証し、取り違えや集計の不一致はなかった。
この実行中の圧縮・swap・Metal allocator情報は採取していないため、差の原因は断定できない。
当該workerの生存時モジュール一覧も未採取であり、worker識別は単一ロード・親子関係・時刻・
メモリ量に基づく推定である。RSSもfootprintも単独で必要RAMの保証値にはしない。[^mlx8-audit]

# 完了した結果

全18構成・72ケースが終了し、49ケース成功、10構成が4/4だった。GBは10^9 bytes。
メモリは各指標の標本最大値で、両列を足した値や大きい方を「必要RAM」とは扱わない。[^raw]

| モデル | Android成功/4 | Web成功/4 | Android合計秒 | RSS最大 GB | footprint最大 GB | footprint有効/総標本 |
|---|---:|---:|---:|---:|---:|---:|
| 26B-A4B QAT MLX 4bit（対照） | 4/4 | 4/4 | 186.869 | 15.42 | 21.32 | 187/188 |
| 31B MLX 4bit | 4/4 | 4/4 | 299.767 | 25.21 | 28.64 | 299/300 |
| 26B-A4B QAT GGUF Q4_0 | 4/4 | 4/4 | 187.629 | 18.24 | 3.81 | 186/188 |
| E4B QAT GGUF Q4_0 | 4/4 | 4/4 | 167.041 | 7.56 | 2.30 | 165/167 |
| E4B MLX 8bit（対照） | 0/4 | 1/4 | 212.687 | 11.95 | 13.14 | 211/213 |
| E2B MLX 4bit | 0/4 | 0/4 | 310.108 | 7.10 | 8.19 | 308/310 |
| E2B MLX 8bit | 0/4 | 0/4 | 247.571 | 8.69 | 9.73 | 247/248 |
| 31B MLX 5bit | 4/4 | 4/4 | 321.903 | 28.65 | 32.39 | 320/323 |
| 31B MLX 6bit | 4/4 | 4/4 | 297.237 | 31.49 | 36.37 | 295/297 |
| 31B MLX 8bit | 4/4 | 4/4 | 314.423 | 15.91 | 43.83 | 313/314 |
| 31B QAT GGUF Q4_0 | 4/4 | 4/4 | 573.350 | 25.74 | 8.11 | 568/572 |
| 12B MLX 5bit | 4/4 | 4/4 | 229.515 | 12.59 | 14.28 | 228/230 |
| 12B MLX 6bit | 3/4 | 3/4 | 259.982 | 14.56 | 16.16 | 256/260 |
| 12B MLX 8bit | 3/4 | 3/4 | 223.860 | 17.46 | 18.94 | 221/223 |
| 12B QAT GGUF Q4_0 | 4/4 | 4/4 | 282.756 | 10.82 | 3.83 | 278/282 |
| E4B MLX 4bit | 2/4 | 3/4 | 509.134 | 10.05 | 10.54 | 500/507 |
| E4B MLX 5bit | 1/4 | 1/4 | 342.999 | 10.68 | 11.25 | 340/342 |
| E4B MLX 6bit | 0/4 | 0/4 | 159.781 | 10.94 | 12.36 | 159/161 |

31B MLX 4bitは299.767秒、26B QAT MLX対照は186.869秒、26B QAT GGUFは187.629秒。
この4ケースでは全て4/4で、31Bの信頼性優位は観測できず、31B MLX 4bitは26B MLXの約1.60倍の所要時間だった。
31B QAT GGUFは573.350秒。ロード時間は除外し、画面取得・端末操作・推論・ケース処理を含む。
各構成1回の固定順序試験であり、速度差を量子化・ランタイムだけの因果効果とは断定しない。[^raw]

# ケース別の失敗

| モデル | 正常ログイン | 誤パスワード | カート | 注文 |
|---|---|---|---|---|
| E4B MLX 8bit（対照） | error | error | error | error |
| E2B MLX 4bit | failed | failed | failed | failed |
| E2B MLX 8bit | failed | failed | error | error |
| 12B MLX 6bit | 成功 | failed | 成功 | 成功 |
| 12B MLX 8bit | 成功 | failed | 成功 | 成功 |
| E4B MLX 4bit | error | 成功 | 成功 | failed |
| E4B MLX 5bit | error | error | 成功 | failed |
| E4B MLX 6bit | error | error | error | error |

failedは上限到達など、errorは有効な操作を取得できず例外終了したケース。どちらも成功に数えない。[^raw]

12B MLX 6bit / 8bitは、正しい認証情報を入力し期待したエラーが出た後もLoginを繰り返し、
15ステップ上限に達した。Tool Call形式エラーは0件で、終了判断の失敗である。
Webでも同じケースが失敗した。12B MLX 5bitと12B QAT GGUFは4/4を完走した。[^case-audit]

E4B QAT GGUFはWeb・Androidとも4/4。E4B全体を動作不良とはまとめられない。
E4B MLX 4bitはAndroidで2/4。正常ログインは3操作後にTool Call欠落、注文はコード4821を
rememberせず画面を離れ、文字列 `confirmation code` を繰り返し入力して30ステップで失敗した。
存在しないref=2への入力も3回あった。途中報告の3/4は正常ログインの終了状態を見落とした誤りであり、
保存済みsummary/runの再照合に基づき2/4へ訂正した。Webの3/4とは区別する。[^case-audit]

E4B MLX 5bitは1/4で、Androidで成功したのはカートだけだった。
注文ではrememberを省略し、123456の反復入力・注文操作、存在しないref=6への入力を経て上限に達した。
6bitと8bitは0/4。6bitの注文は `CONFIRMATIONCODE` を入力し、注文操作を14回反復した後に
Tool Call欠落で終了。8bitもrememberを省略し、123456を反復入力した後に形式エラーとなった。[^case-audit]

E2B MLX 4bitは全80操作がメール欄への同じ入力で、全ケース上限failed。
8bitもメール入力やLoginを繰り返し、ログイン系2ケースは上限、購入系2ケースはTool Call欠落で終了した。
Androidでは入力文字列の追記を観測したが、Web側が必ず置換するとは断定しない。
`input_text` は両経路ともtap後にtypeTextを呼び、明示的な入力消去はない。[^case-audit][^harness]

LLMの失敗試行は41回。E2B MLX 8bitの誤パスワードで2失敗試行から1判断が回復したが、
そのケース自体は上限failedだった。未回復は39試行であり、試行単位の回復とケース成功は区別する。[^raw]

# 証跡の検証と制限

全18構成が4ケースずつ終了し、モデル・対象・入力fixtureの検査エラーは0件。
成功49ケースは最終UIだけでなく、指定の認証情報、商品と数量、表示コードの使用を操作履歴で確認した。
全23失敗の原因をstep番号付きで記録し、全36個のrun/summary原本ハッシュを再照合した。[^case-audit]

RSSは5125/5125標本、footprintは5081/5125標本が有効。
欠測44件はすべて取得中に終了した子プロセスのerrno=3で、0に置換していない。
単位変換・プロセス合算・中央値・標本最大値を全原本から再計算し、保存summaryと一致した。
計測期間が各モデルの4ケースの開始から終了までを覆うことも確認した。[^memory-final]

操作スクリーンショットは648/648枚存在する。録画は66/72ファイル存在し、6件が欠落していた。
欠落は31B MLX 6bitの誤パスワード/カート、31B GGUFのカート、E4B GGUFのカート、
E2B MLX 4bit/8bitの注文。録画欠落を理由に再試験してモデル成績を置き換えていない。
成功判定はrun内のUIと操作履歴を根拠にし、全ケースの動画を確認できたとは主張しない。[^raw][^recording]

存在する66本はffprobeで有効な動画ストリームと正の長さを確認した。ただし26B MLXの正常ログインは
ケース35.097秒に対して動画13.89秒であり、全経過を録画できた保証はない。
欠落6件もrecord.started/stoppedが記録されていた。既存recorderは終了コードの成否やファイル存在を検証せず、
scrcpyの標準出力・標準エラーも保存していないため、欠落の直接原因は特定できない。
今回は録画実装を変更せず、この不備をモデル成績とは別の観測として記録した。[^recording]

LLMなしのpreflightでAndroidの4条件が通り、descだけ・隣接要素・入力欄・重複IDの4否定条件は拒否した。
Androidのbutton子TextViewを許容する補助判定の変更後も、既存Web72ケースの判定は不変だった。
代表画像として26B MLXの注文成功画面とE4B MLX 8bitの誤コード反復画面を視覚確認した。
全画像の目視確認ではない。検証記録は `oracle-preflight-verification.json` と `visual-verification.json`。[^raw]

各モデル4ケースを1回ずつ測るスモーク試験で、一般的な完走率や反復安定性は推定できない。
失敗した構成は早く終了し得るため、所要時間を成功構成と単純比較しない。
エミュレーターを同じMacで動かす負荷もあり、以前のWeb所要時間との違いをモデルだけの差と断定しない。

[^raw]: `bench/e2e/android-results/`。18構成の完成したsummaryとモデル別集計。
[^fixture]: `bench/e2e/fixtures.json` のandroidエントリー。
[^harness]: `bench/e2e/matrix.py`、`run.py`、`memory.py`、`summarize.py`。
[^artifacts]: `var/model-e2e-android-20260927/` の `apk-build.json`、`preflight.json`、`emulator.log`、`avd/hardware-qemu.ini` と実行証跡。
[^memory-abi]: `bench/e2e/android-results/memory-footprint-verification.json` と同ディレクトリのC probe・smoke JSONL/summary。
[^worker]: `bench/e2e/android-results/memory-worker-coverage.json`。
[^gguf-worker]: `bench/e2e/android-results/memory-gguf-worker-coverage.json`。ps/lsof、途中標本、vmmap summaryと対象GGUF領域の読取結果。
[^footprint-definition]: [Apple WWDC24: Analyze heap memory](https://developer.apple.com/videos/play/wwdc2024/10173/)。clean領域とfootprintの区別。
[^retrospective]: `bench/e2e/results/memory-retrospective.json`。
[^mlx8-audit]: `bench/e2e/android-results/memory-31b-mlx-8bit-audit.json`。
[^wire]: `bench/e2e/results/genkit-wire-probe.json`。送信形状の検査でありモデルの成功数には含めない。
[^case-audit]: `bench/e2e/android-results/failure-analysis.json`。
[^memory-final]: `bench/e2e/android-results/memory-final-verification.json`。
[^recording]: `bench/e2e/android-results/recording-verification.json`。
