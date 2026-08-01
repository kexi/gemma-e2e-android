---
type: Decision
title: "Per-case screen recording: scrcpy --no-playback --record"
description: Every case is filmed end to end so a failure nobody watched live can be replayed.
status: stable
tags: [scrcpy, recording, dashboard, adb]
sources:
  - id: recording
    resource: b9a357ce01eed01b4e792a5ffe3341ed65012b51
    title: Record each test case to video so failures can be replayed
  - id: scrcpy-devshell
    resource: 2a289956364f5fdff21410382dfde8056a932b07
    title: Add scrcpy and a mirror task for watching the headless emulator
verified:
  by: human:kexi
  at: 2026-08-01T15:12:00Z
---

各ケースは最初から最後まで録画されます。ランナーはアプリのリセット直前に
ケースごとの scrcpy を起動し、判定が確定した時点で端末側のキャプチャを終了させて
scrcpy に `var/videos/{runId}/{caseId}.mp4` を確定させ、自ら終了させます。パスは
`CaseRun` に載り、ダッシュボードは終了したケースのアコーディオン内でそれを再生
します。`RECORD_RUNS=0` で機能全体を無効化できます。

*なぜ run 単位でなくケース単位か:* 判定の単位はケースなので、「落ちたケースを見る」
ために通ったケースをスクラブさせるべきではありません。スクリーンショットの
保存構造とも揃います。

*なぜ `adb shell screenrecord` でないか:* 3 分で打ち切られますが、20 ステップの
予算をローカルモデルで消化するケースは普通にそれを超えます。加えて出力は端末上に
残るため、あとから取り出す手間もかかります。

*なぜ `adb emu screenrecord` でないか:* エミュレータ専用なので、実機のために同じ
機能をもう一度実装することになります。scrcpy は端末の H.264 ストリームを adb 経由で
引き出してホスト側で mux するため、両方を 1 つの実装で、時間制限なしにカバーできます。

*なぜ `--no-playback` か:* 欲しいのは録画ファイルであり、ミラーリング用ウィンドウは
ディスプレイを要求します(ヘッドレスな CI マシンには無い)。ダッシュボードの
ライブビューは別経路(gRPC フレーム)なので影響しません。

*なぜ停止がシグナルではなく端末側の `adb shell pkill` なのか:* これは実機検証で
判明しました。scrcpy 4.1 は割り込み処理を SDL のイベントループ経由で行いますが、
`--no-playback` かつサーバプロセスからの起動ではそのループが回らないため、
**`SIGINT` も `SIGTERM` も完全に無視されます**。素直な実装(`SIGINT` を送り、
タイムアウトで `SIGKILL` にフォールバック)は毎回 `moov` アトムのないファイルを
生成し、`ffprobe` は "moov atom not found" を返してどのプレーヤーでも開けませんでした。
代わりに端末側のキャプチャを終了させると、scrcpy が唯一監視している経路 —
ビデオストリームの終端 — に届き、自らインデックスを書いて終了します。`stop()` は
その終了を待つので、パスを誰かに渡す時点でファイルは完成しています。`SIGKILL` の
タイムアウトは、固まった scrcpy が端末を掴んだままになるのを防ぐためだけに残してあり、
その場合は再生不能なファイルのパスを返さず録画失敗として報告します。

*なぜこの録画が起動したサーバの PID だけを kill するか:* 名前で一致させると、同じ
デバイス上の他の録画のキャプチャまで終了させ、そのファイルを途中で切ってしまいます。
spawn 前に存在していた PID を控えておき、この録画が作った分だけを対象にします。

*なぜ各ケース冒頭が欠けうるか:* scrcpy はビデオソケットの確立に少し時間がかかり、
最初のフレームを待つとその遅延が全ケースに乗ります。失われるのはアプリのリセット
画面で、判定はそこに依存しません。

*なぜ録画はベストエフォートか:* scrcpy が無い、あるいは端末がエンコーダを拒む場合は
`record.failed` を warn に出して `videoPath` を null にするだけで、ケース自体は
落としません。判定はステップログが決めるものであり、動画はスクリーンショットと同じく
デバッグ用の補助だからです。なお **エラーで終わったケースの録画は保持されます** —
最も見る価値があるのがそれだからです。
