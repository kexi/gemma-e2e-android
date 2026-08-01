---
type: Decision
title: "Live device view: gRPC streamScreenshot relayed over a WebSocket"
description: The Hono server relays the emulator's gRPC PNG frames to the browser itself, with no proxy.
status: stable
tags: [emulator, grpc, websocket, dashboard]
sources:
  - id: live-view
    resource: e177478ad218d56a4743668b57dde97fae064c51
    title: Show the emulator screen live while a run is in progress
---

ダッシュボードはエミュレータの画面をライブ表示します(専用の Device ページと、
実行中の run のステップタイムライン横の両方)。Hono サーバがエミュレータの gRPC
ブリッジ(`emulator -grpc 8554`)に接続し、`EmulatorController` サービスの
サーバストリーミング `streamScreenshot` を購読して、届いた PNG をそのまま
バイナリの WebSocket フレームとしてブラウザへ送ります。クライアントは object URL
にして描画します。`apps/web/server/proto/emulator_controller.proto` は
エミュレータ同梱の `lib/` からベンダリングしたもので、`@grpc/proto-loader` が
実行時に読み込むため、ビルドレスなワークスペースに codegen が入りません。

*Why not `android-emulator-webrtc` の WebRTC:* Google 公式の React コンポーネント
であり第一候補でしたが、デスクトップ版エミュレータでは動作しません。現行の 2.0.1
は "Emulator Gateway" に対して REST + WebSocket JSEP で話す設計で、その
ゲートウェイの役割は JSEP をエミュレータの `Rtc` gRPC サービスへ中継することです。
しかしこのビルドに `Rtc` サービスは存在しません。emulator 37.2.2 の
darwin-aarch64 版は `rtc_service.proto` を同梱しておらず、バイナリに登録された
`android.emulation.control.*` サービスは `EmulatorController` /
`SnapshotService` / `UiController` / `Adb` のみで、`Rtc` も
`requestRtcStream` / `sendJsepMessage` のシンボルも見つかりません。RTC サービスは
Google の Linux コンテナ用 `emulator-webrtc` イメージにのみ組み込まれています。
旧版 1.0.18 も解決になりません。PNG フォールバックは `getScreenshot` を grpc-web
で呼びますが、ブリッジは grpc-web も話さないため、結局 Envoy や grpcwebproxy が
必要になります。`streamScreenshot` を自前で中継すれば、プロセスを1つ減らし、
プロキシなしで同じ画面に到達できます。

*捨てたもの:* 音声・入力転送・動画コーデック並みの効率。いずれも不要です。この
ビューはエージェントの動作を見るためのもので、操作は adb 経由で行われます。

*フレームが「止まって見える」理由:* `streamScreenshot` は画面が変化したときだけ
フレームを出すため、静止したデバイスではフレームが来ないのが正常です。中継側では
アニメーション時にソケットが溢れないよう 20fps 程度に間引いています。

*Why 認証なしの gRPC:* ブリッジは localhost にのみバインドし、`-grpc-use-token`
なしで起動するため提示すべき資格情報がありません。リポジトリ内でこのフラグに
依存しているものは他になく、外してもライブビューが消えるだけです。
