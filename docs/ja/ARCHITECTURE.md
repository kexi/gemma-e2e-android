# アーキテクチャ

このプロジェクトの構成 — 何をモデル化し、どんなループを回し、各判断がどこに
書かれているか。

各判断(何を選んだか・なぜか・何を採らなかったか)は
[Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf)
v0.2 に従い、[knowledge/](knowledge/index.md) 以下に 1 ファイル 1 件で置いています。
このページは概観と図だけを持ち、理由は再掲しません(二重管理を作らないため)。

English: [../ARCHITECTURE.md](../ARCHITECTURE.md)

## ドメイン: シナリオはテストケースの束

**テストケース**は 1 つの判定を得る自然言語のゴール、**シナリオ**は対象アプリと
(多くの場合)モデルを共有するケースの束です。

```
   Scenario (scenarios/login.yaml)
   ├─ id, title, app?, model?
   └─ cases: TestCase[]            (1 つ以上・宣言順に実行)
      ├─ TestCase { id (slug), title?, prompt, model?, maxSteps=20 }
      └─ TestCase { … }

   シナリオ 1 回の実行:

   Run  { id, scenarioId, title, status, verdictReason, startedAt, finishedAt }
   └─ CaseRun { caseId, order, title, prompt, model, status, verdictReason,
      │          videoPath, … }
      └─ Step { index, action, uiText, screenshotPath, note, createdAt }
```

判定の単位がケースである理由、逐次実行する理由、
`case.model ?? scenario.model ?? LLM_MODEL` の解決順序:
[knowledge/scenarios-bundle-cases.md](knowledge/scenarios-bundle-cases.md)。

## E2E ループ

各ケースが、知覚 → 判断 → 操作 → 判定のループを、ゴール達成かステップ上限まで
繰り返します。

```
                  ┌──────────────────────────────────────────┐
                  │                                          │
   ┌──────────────▼───────────────┐                          │
   │ Android 実機 / エミュレータ  │                          │
   └──────────────┬───────────────┘                          │
                  │ adb shell uiautomator dump               │
                  ▼                                          │
   ┌──────────────────────────────┐                          │
   │ UI ツリー(XML → テキスト)  │                          │
   └──────────────┬───────────────┘                          │
                  │ prompt: ゴール + UI ツリー + 履歴        │
                  ▼                                          │
   ┌──────────────────────────────┐                          │
   │ Gemma 4(LM Studio 経由)     │                          │
   │ Genkit + Zod 構造化出力      │                          │
   └──────────────┬───────────────┘                          │
                  │ {action: tap|type|swipe|back|assert, …}  │
                  ▼                                          │
   ┌──────────────────────────────┐   adb input / shell      │
   │ 操作実行                     │──────────────────────────┘
   └──────────────┬───────────────┘
                  │ ステップログ + スクショパス + 判定
                  ▼
   ┌──────────────────────────────┐      ┌────────────────────┐
   │ Firestore 実行履歴           │◄─────┤ Hono サーバ + SSE  │
   │ runs/{id}/cases/{id}/steps   │      └─────────┬──────────┘
   └──────────────────────────────┘                │
                                         ┌─────────▼──────────┐
                                         │ Web ダッシュボード │
                                         │ Vite + React + MUI │
                                         └────────────────────┘
```

## リポジトリ構成

```
apps/example    テスト対象の Expo アプリ
apps/web        Vite + React ダッシュボード
packages/*      エージェント本体・adb ラッパ・LLM クライアント(ビルドレス TS)
```

## 各判断

[knowledge/](knowledge/index.md) 以下に 1 ファイル 1 件。

### ドメイン

| 判断 | ファイル |
| --- | --- |
| ドメイン: シナリオはテストケースの束 | [scenarios-bundle-cases.md](knowledge/scenarios-bundle-cases.md) |
| シナリオ: ファイル管理 + ad-hoc 実行 | [scenarios-files-and-ad-hoc.md](knowledge/scenarios-files-and-ad-hoc.md) |

### エージェントループ

| 判断 | ファイル |
| --- | --- |
| UI 取得: `adb shell uiautomator dump` | [ui-capture-uiautomator-dump.md](knowledge/ui-capture-uiautomator-dump.md) |
| モデル入力: UI ツリーのテキストのみ | [model-input-ui-tree-text.md](knowledge/model-input-ui-tree-text.md) |
| LM Studio + Gemma 4 / Genkit + Zod | [lm-studio-genkit-zod.md](knowledge/lm-studio-genkit-zod.md) |

### 永続化

| 判断 | ファイル |
| --- | --- |
| 実行履歴: Firestore + ファイル | [run-history-firestore.md](knowledge/run-history-firestore.md) |
| 汎用 Zod コンバータ: 双方向で検証する | [zod-firestore-converter.md](knowledge/zod-firestore-converter.md) |

### ダッシュボード

| 判断 | ファイル |
| --- | --- |
| Web ダッシュボード: Vite + React + Hono + MUI | [web-dashboard-stack.md](knowledge/web-dashboard-stack.md) |
| SSE は維持し、Firestore リスナーは将来の選択肢 | [sse-over-firestore-listeners.md](knowledge/sse-over-firestore-listeners.md) |
| デバイスのライブビュー: gRPC `streamScreenshot` の中継 | [live-device-view.md](knowledge/live-device-view.md) |
| ケース単位の画面録画: `scrcpy --no-playback --record` | [per-case-screen-recording.md](knowledge/per-case-screen-recording.md) |

### プラットフォームとツール

| 判断 | ファイル |
| --- | --- |
| Expo prebuild(CNG) | [expo-prebuild-cng.md](knowledge/expo-prebuild-cng.md) |
| Bun への全面統一 | [bun-everywhere.md](knowledge/bun-everywhere.md) |
| TypeScript strict・ビルドレス | [typescript-strict-buildless.md](knowledge/typescript-strict-buildless.md) |
| oxlint / oxfmt | [oxlint-oxfmt.md](knowledge/oxlint-oxfmt.md) |
| 構造化ログ: stderr への NDJSON を Zod で検証 | [structured-logs-ndjson.md](knowledge/structured-logs-ndjson.md) |
| 供給網対策: 公開後 1 日ルールを 3 層で揃える | [supply-chain-release-age.md](knowledge/supply-chain-release-age.md) |
| ツールとプロセス | [tooling-and-process.md](knowledge/tooling-and-process.md) |
