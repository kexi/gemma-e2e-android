# アーキテクチャ

このプロジェクトの技術方針と、「なぜそれを選んだか」「なぜ他を採らなかったか」の
記録です。現時点では開発環境のみが存在し、アプリケーションコードは次のタスク以降で
実装します。

English: [../ARCHITECTURE.md](../ARCHITECTURE.md)

## E2E ループ

テストは自然言語のゴール(例:「ログインできることを確認」)です。エージェントは
知覚 → 判断 → 操作 → 判定のループを、ゴール達成かステップ上限まで繰り返します。

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
   │ SQLite 実行履歴              │◄─────┤ Hono サーバ + SSE  │
   └──────────────────────────────┘      └─────────┬──────────┘
                                                   │
                                         ┌─────────▼──────────┐
                                         │ Web ダッシュボード │
                                         │ Vite + React + MUI │
                                         └────────────────────┘
```

## 想定するリポジトリ構成

```
apps/example    テスト対象の Expo アプリ
apps/web        Vite + React ダッシュボード
packages/*      エージェントコア・adb ラッパー・LLM クライアント(ビルドレス TS)
```

## 各判断

### Expo prebuild(CNG)

CNG は app config から `android/` / `ios/` を再生成するため、ネイティブ
プロジェクトは使い捨てにでき、gitignore しています。Android SDK と
Azul Zulu JDK 17(Expo 推奨の JDK)を devshell に入れる根拠がこれです
(managed workflow だけなら不要でした)。

*なぜ `jdk17` でなく `zulu17` か:* nixpkgs の `jdk17` は darwin では既に Zulu の
実体ですが、Linux では素の OpenJDK になります。`zulu17` と明示することで意図を
示し、全プラットフォームで同じ JVM に揃えます。

*なぜ Expo Go でないか:* エージェントはネイティブモジュールを含む現実的な UI を
操作する必要があり、Go はカスタムネイティブコードを載せられません。

### Bun への全面統一(パッケージマネージャ・ランタイム・テストランナー)

インストール・TypeScript 実行・`bun test` を 1 つのツールで賄います。Bun が TS を
そのまま実行できることが、`packages/*` のビルドレス構成を成立させています。
モノレポは Bun の `workspaces` を使います。

*なぜ pnpm + Node + Vitest でないか:* 3 つのツールと 3 つの設定を同期し続ける
必要があるためです。*受け入れたリスク:* Genkit は Bun を公式サポートしていません。
逃げ道として Node 22 を devshell に残しており、問題が出たらエージェントのみ Node で
動かします。

### 供給網対策: 公開後 1 日ルールを 3 層で揃える

公開から 24 時間未満のものは一切取り込みません。侵害されたリリースが lockfile に
入る前に検知・取り下げされる猶予を作るためです。

| 層 | 仕組み |
| --- | --- |
| npm パッケージ | `bunfig.toml` → `minimumReleaseAge = 86400`(秒) |
| GitHub Actions | `just pin` → `pinact run --min-age 1`(日) |
| 更新 PR | `renovate.json` → `minimumReleaseAge: "1 day"` |

さらに pinact が Actions を 40 文字 SHA に固定し、タグは末尾コメントに残します。
Renovate の `helpers:pinGitHubActionDigests` がその固定を追従します。

*なぜタグを信頼しないか:* 可変タグはレビュー後に悪意あるコードへ差し替えられます。

### TypeScript strict・ビルドレス

`tsconfig.base.json` で `strict` / `noUncheckedIndexedAccess` /
`exactOptionalPropertyTypes` などを有効にし、全 app / package がこれを extends
します。`packages/*` は TS ソースのまま workspace 内で参照されます。

*なぜ今バンドラを入れないか:* 消費側が同一リポジトリ内の Bun だけである以上、
ビルド段階に得るものがありません。npm publish や単一ファイル化が必要になった
時点で [tsdown](https://tsdown.dev/) を導入します。

### oxlint / oxfmt

Rust 製で TS/TSX をネイティブに扱え、staged ファイルに対する pre-commit フックで
実用的な速度が出ます。devshell ではなく `devDependencies` に置いているのは、
JS ツールチェーンのバージョンを workspace 側で一体管理するほうが Expo
エコシステムと整合するためです。

*なぜ ESLint + Prettier でないか:* 遅く、監査対象のプラグイン面が大きすぎます。
*留意点:* oxfmt は 1.0 前です。不安定なら `fmt` 系タスクだけ切り離せます。

### Web ダッシュボード: Vite + React + Hono + MUI

ランナーの操作は最初からブラウザで行います(プロンプト投入・ステップの逐次表示・
スクリーンショット閲覧)。Hono はエージェントプロセスと同居し、SSE/WebSocket で
進捗を配信します。MUI + MUI Icons でデータ密度の高い画面をデザイン自作なしに
組みます。

*なぜ CLI 先行でないか:* 主要なデバッグ材料がステップログとスクリーンショット
であり、ターミナルはどちらの表示にも向きません。

### LM Studio + Gemma 4 / Genkit + Zod

モデルはローカルの MLX エンジンで動かします(`gemma-4-12b`、メモリが厳しければ
E4B)。Genkit の OpenAI 互換プラグインを `http://localhost:1234/v1` に向け、操作
判断はすべて Zod で検証した構造化出力として受け取ります。

*なぜネイティブ tool call を使わないか:* MLX 系 Gemma 4 の tool call パーサが
不安定なため、構造化出力で完全に回避します。Genkit は判断ごとのトレースを Dev UI
で確認でき(「なぜそこをタップしたか」)、将来 `genkit eval` で判断品質の回帰
テストにも繋げられます。LM Studio は GUI アプリのため手動インストールです。

### UI 取得: `adb shell uiautomator dump`

追加アプリも計装サーバも端末側コードも不要で、シェルコマンドから XML が得られます。

*なぜ Appium UiAutomator2 や自作 Accessibility Service でないか:* 高速ですが、
インストール・起動・バージョン同期が必要なサーバが増えます。dump のレイテンシが
ボトルネックになった時点で再検討します。

### モデル入力: UI ツリーのテキストのみ

スクリーンショットは取得・保存しダッシュボードに表示しますが、モデルには渡しません。
テキストのみのプロンプトは小さく速く、UI ツリーには操作に必要な resource ID と
アクセシビリティラベルが既に含まれています。

*なぜ画像入力を使わないか:* Gemma 4 は画像を扱えるので精度が必要になれば解禁でき
ますが、トークンとレイテンシの実コストが伴います。

### 実行履歴: SQLite + ファイル

ステップログと判定結果は SQLite(クエリ可能・単一ファイル・セットアップ不要)、
スクリーンショットはファイルに置きパスを DB に持ちます。

*なぜ DB に blob を入れないか:* 大きなバイナリはファイルを肥大させ、それを必要と
しないクエリまで遅くします。

### 構造化ログ: stderr への NDJSON を Zod で検証

実行時のログは 1 行 1 JSON として stderr に出力します。共通の骨格は固定で、
`ts`(ISO 8601)・`level`(`debug`/`info`/`warn`/`error`)・`event`(`run.step`
`adb.exec_failed` `http.request` のようなドット区切りの名前空間)を必ず持ち、
イベント固有の構造化フィールドをそこに並べます。`LogEvent` スキーマと
`createLogger` は `@gemma-e2e/logger` が持ち、`child()` で `runId` などの
コンテキストを束ねると以降の全行に伝播します。

ライブラリは自分からは書きません。`packages/adb`・`packages/agent`・Hono アプリ
はいずれも `logger` を受け取り、既定は no-op です。出力の可否はプロセスの
エントリポイント 1 箇所だけが決めます。テストでは収集用の sink を注入するだけで
発行イベントを検証できます。

*なぜ stdout でなく stderr か:* stdout はコマンド本来の出力の場所であり、結果を
`jq` に流したときにログまで飲み込まれてはいけないためです。

*なぜ pino や winston を使わないか:* 目的である「Zod による検証」は既に満たして
おり、残りは JSON 1 行とレベル絞り込みだけだからです。*なぜ検証失敗で例外に
しないか:* ログのフィールド不備で実行を止める価値はないため、不正なイベントも
そのまま出力し、直前に該当パスを示す `log.invalid_event` 警告を出します。開発中は
気づけて、本番では無害です。

### シナリオ: ファイル管理 + ad-hoc 実行

テストシナリオは YAML/Markdown としてリポジトリに置き、レビュー・バージョン管理・
CI での再実行を可能にします。加えてダッシュボードからコミットされていない単発の
プロンプトも実行できます。

### ツールとプロセス

- **Nix flake + direnv** — SDK・Zulu JDK・Bun・各 CLI を `flake.lock` で固定するため、
  「自分の環境では動く」が「あなたの環境でも動く」になります。Android SDK は
  [android-nixpkgs](https://github.com/tadfisher/android-nixpkgs) から取得し
  Android Studio を不要にしています。`adb` は SDK 由来の 1 本のみで、nixpkgs の
  `android-tools` とは二重化させません。
- **just** — npm scripts の羅列ではなく、`just --list` で発見できる薄いタスク一覧。
- **lefthook + gitleaks** — 秘密情報は修正が安いコミット時点で止めます。push 済みの
  鍵のローテーションは安くありません。
- **Renovate** — 依存更新をローカルと同じ公開後日数ポリシーで PR にします。
- **英語を原本とし日本語を併置** — ドキュメントとコメントは英語で書き、`docs/ja/`
  に日本語版を置きます。
- **MIT ライセンス。**
