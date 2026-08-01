---
okf_version: "0.2"
---

# 各判断

このプロジェクトの技術的判断を 1 ファイル 1 件で記録したものです。形式は
[Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf)
v0.2。それぞれ「何を選んだか・なぜか・何を採らなかったか」を書いています。

概観とデータフロー図は [../ARCHITECTURE.md](../ARCHITECTURE.md) にあり、そこから
各ファイルへリンクしています。

English: [../../knowledge/index.md](../../knowledge/index.md)

## ドメイン

- [scenarios-bundle-cases.md](scenarios-bundle-cases.md) — ドメイン: シナリオはテストケースの束
- [scenarios-files-and-ad-hoc.md](scenarios-files-and-ad-hoc.md) — シナリオ: ファイル管理 + ad-hoc 実行

## エージェントループ

- [ui-capture-uiautomator-dump.md](ui-capture-uiautomator-dump.md) — UI 取得: `adb shell uiautomator dump`
- [model-input-ui-tree-text.md](model-input-ui-tree-text.md) — モデル入力: UI ツリーのテキストのみ
- [lm-studio-genkit-zod.md](lm-studio-genkit-zod.md) — LM Studio + Gemma 4 / Genkit + Zod

## 永続化

- [run-history-firestore.md](run-history-firestore.md) — 実行履歴: Firestore + ファイル
- [zod-firestore-converter.md](zod-firestore-converter.md) — 汎用 Zod コンバータ: 双方向で検証する

## ダッシュボード

- [web-dashboard-stack.md](web-dashboard-stack.md) — Web ダッシュボード: Vite + React + Hono + MUI
- [sse-over-firestore-listeners.md](sse-over-firestore-listeners.md) — SSE は維持し、Firestore リスナーは将来の選択肢
- [live-device-view.md](live-device-view.md) — デバイスのライブビュー: gRPC `streamScreenshot` を WebSocket で中継
- [per-case-screen-recording.md](per-case-screen-recording.md) — ケース単位の画面録画: `scrcpy --no-playback --record`

## プラットフォームとツール

- [expo-prebuild-cng.md](expo-prebuild-cng.md) — Expo prebuild(CNG)
- [bun-everywhere.md](bun-everywhere.md) — Bun への全面統一
- [typescript-strict-buildless.md](typescript-strict-buildless.md) — TypeScript strict・ビルドレス
- [oxlint-oxfmt.md](oxlint-oxfmt.md) — oxlint / oxfmt
- [structured-logs-ndjson.md](structured-logs-ndjson.md) — 構造化ログ: stderr への NDJSON を Zod で検証
- [supply-chain-release-age.md](supply-chain-release-age.md) — 供給網対策: 公開後 1 日ルールを 3 層で揃える
- [tooling-and-process.md](tooling-and-process.md) — ツールとプロセス
