# gemma-e2e-android

English: [../../README.md](../../README.md)

自然言語のプロンプトから、Android 端末または Chrome 上で E2E テストを実行します。
*「ユーザーがログインできることを確認」* のように書くと、ローカルの
[Gemma](https://ai.google.dev/gemma) モデルで動くエージェントがライブの UI ツリーを
読み、次にタップ・入力する対象を決めて実行し、ゴールを達成できたかを判定します。
すべて手元のマシンで動きます — LLM は LM Studio がローカルで提供するので、
スクリーンショットやアプリのデータがマシンの外へ出ることはありません。

テストケースはそれぞれ対象(target)を指定するため、1 つのシナリオで両
プラットフォームをカバーでき、プロンプトはどちらでも同じままです。

## 仕組み

```text
              ┌── adb uiautomator dump ──┐
scenario ─▶   │                          ├─▶ UI tree (text)
prompt        └── CDP DOM walk ──────────┘         │
                     ▲                      Gemma 4 (LM Studio)
                     │                             │
              tap / type / scroll ◀── structured Action
                     │
                     ▼
     Firestore history + screenshots + video ─▶ dashboard (live via SSE)
```

両プラットフォームが同じ `UiNode` ツリーを生成するため、モデルが読むシリアライザ、
モデルが答えるアクションの語彙、その背後のプロンプトはいずれも 2 本ではなく実装
1 本です。

## 視覚的アクセシビリティレビュー

シナリオエディタの **Visual accessibility review** でペルソナを選びます:
赤・緑または青・黄の色の見分けにくさ、老眼(近くの文字の読みやすさ)、ロービジョン。
見え方の条件を編集したり、独自のペルソナを追加したりもできます。各ケースは、
独自のペルソナを選ばない限りシナリオの選択を引き継ぎます。何も選ばなければ
レビューは無効です。既存のシナリオは既定でレビュー無効のままです。

YAML のシナリオでは、ペルソナを明示的に記述します:

```yaml
title: Login with visual review
target:
  platform: web
  url: http://localhost:5174
accessibility:
  personas:
    - id: presbyopia
      label: 老眼・近くの文字の読みづらさ
      description: 小さい文字や細い線、低コントラストによる読みにくさを確認する。
    - id: red-green
      label: 赤・緑の見分けにくさ
      description: 状態や操作を色だけで区別せず、文字や形でも識別できるか確認する。
cases:
  - id: login
    prompt: Check that the user can log in.
  - id: functional-only
    prompt: Check that an incorrect password is rejected.
    accessibility:
      personas: []
```

Android でも Android 用の `target` で同じ設定を使います。ケースで選ぶモデルは画像
入力に対応している必要があります。各ステップでは、最初の画面とエージェントが終了
する画面も含め、**操作前**の PNG を別途取得します。Gemma は操作のあとで保存済みの
その画像をレビューするため、現在の UI ツリーから選ぶ操作が画像推論で遅れることは
ありません。選んだペルソナはまとめて評価し、出力が不正な場合は 1 回だけ再試行します。
run のタイムラインには、問題の可能性ごとに場所・理由・改善案が、レビューした画像への
リンクとともに表示されます。既存のステップのサムネイルは操作後の画像のままです。
ペルソナ定義とモデルはレビューと一緒に保存されるので、あとでシナリオを変更しても
過去の結果の意味は変わりません。

レビューはステップごとに画像モデルへのリクエストを 1 回追加し、再試行も含めて 1 つの
期限で打ち切られます。既定は 120 秒で、`ACCESSIBILITY_REVIEW_TIMEOUT_MS` で変更
できます。モデルがツールを呼ばずに fenced JSON ブロックとして書いたレポートも、同じ
検証を経て受け付けます。失敗はレビューエラーとして記録され、機能面の E2E 判定は
変わりません。レビュー対象はサンプリングした表示中の画面だけで、すべての
アニメーションや一時的な状態を網羅するものではありません。指摘は定性的な提案であり、
誰かの見え方の再現でも WCAG 準拠の判定結果でもありません。指摘が無いことは
アクセシビリティの証明になりません。正確なコントラスト比や物理的な文字サイズは測定
しません。スクリーンリーダーの挙動、読み上げ順序などの視覚以外の挙動はこの機能の
対象外です。

既知の正解に対してレビューを確かめられるよう、ブラウザ版サンプルアプリは
`http://localhost:5174/?lab=a11y` で、問題をわざと仕込んだ画面(色だけで示す状態、
小さく薄い文字、密集したアイコン)を 2 つの問題の無い画面の間に挟んで提供します。
`scenarios/a11y-lab.web.yaml` はそれらを 1 ケース 1 ペルソナでレビューします
(`a11y-lab-all.web.yaml` は 4 つすべてを一度に使います)。これらのタグは `web` では
なく `a11y` と `lab` なので、`web` タグで選ぶ run は速いままです。他のシナリオが
対象とするショップの画面は変わりません。

Android のサンプルアプリも同じ画面を持っています。アプリにはフラグを載せる URL が
無いため、サインイン画面の "Store information" リンクから開き、
`scenarios/a11y-lab.yaml` / `a11y-lab-all.yaml` のプロンプトはそこから始まります。
Android のログイン・ショップのシナリオが見る画面への変更は、このリンク 1 つだけです。

## リポジトリ構成

| パス | 内容 |
| --- | --- |
| `packages/core` | 共有 Zod スキーマ(UI ツリー・アクション・run)と YAML シナリオローダー |
| `packages/adb` | adb ラッパー: UI ダンプの解析と入力コマンド |
| `packages/cdp` | Chrome DevTools Protocol クライアント: ページの読み取り・入力・screencast |
| `packages/agent` | Genkit ベースの判断ループと、各プラットフォームをそれに適合させるドライバ |
| `packages/store` | Firestore の run / ステップ履歴(`firebase-admin` 経由のローカルエミュレータ) |
| `apps/web` | ダッシュボード: Hono API + SSE、Vite / React / MUI のフロントエンド |
| `apps/cli` | ダッシュボード API 用のコマンドラインクライアント `gemma-e2e` |
| `apps/example-shared` | "Kexi Coffee Shop" のドメインデータ(2 つのフィクスチャアプリの食い違いを防ぐ) |
| `apps/example-android` | ショップの Expo ビルド。adb で駆動 |
| `apps/example-web` | ショップのブラウザビルド。CDP で駆動 |
| `scenarios/` | テストシナリオ(`*.yaml`) — 自然言語のゴール。それぞれ Android か Web の target を指定 |
| `e2e/scenarios/` | CLI のテストシナリオ(`*.yaml`) — `gemma-e2e` バイナリ自体を駆動する [pitty](https://github.com/kexi/pitty) のケース |

2 つのシナリオディレクトリは名前が似ていますが無関係です。`scenarios/` は
*プロダクトへの入力*で、Gemma がエミュレータやブラウザに対して実行するプロンプト
です。`e2e/scenarios/` は *CLI のテストコード*で、`gemma-e2e` が何を出力し、どの
終了コードを返すかを検証する PTY セッションです。

## クイックスタート

クローンしてすぐ試したい場合は [QUICK-SETUP.md](QUICK-SETUP.md) を見てください。
`git clone` からシナリオの実行まで、数個のコマンドで進められます。

```sh
direnv allow             # devshell: すべての CLI ツール・Android SDK・エミュレータ
just install-deps        # JavaScript の依存
just launch-all          # 以下すべてを 1 つのターミナルで起動。既に動いているものは飛ばす
```

`launch-all` は初回セットアップが済んでいることを前提とします: LM Studio を
インストールしてモデルをダウンロード済み(`just get-model`)で、AVD を作成済み
(`just create-avd`)であること。Ctrl-C 1 回で自分が起動したものを止めます。
1 つずつ起動する場合は次のとおりです:

```sh
just launch-llm          # LM Studio のローカル API を起動(アプリは手動インストールが必要)
just launch-model        # LLM_MODEL が指定する名前でモデルを読み込む
just launch-web          # ダッシュボード → http://localhost:5173

# Android (scenarios/login.yaml, shop.yaml)
just launch-emu          # エミュレータを起動
just launch-android      # サンプルアプリをビルドしてインストール

# Web (scenarios/login.web.yaml, shop.web.yaml)
just launch-example-web  # ブラウザ版のショップ → http://localhost:5174
just launch-chrome       # ドライバが接続する DevTools ポートを開いた Chrome
```

`just --list` ですべてのタスクを表示し、`just check-all` で CI と同じゲートを実行
します。Nix / direnv や LM Studio のセットアップを含む完全な手順:
[SETUP.md](SETUP.md)。

## CLI

`gemma-e2e` はダッシュボードと同じ API を駆動するので、シナリオと run をターミナルや
CI ジョブから管理できます。ダッシュボードが起動している必要があります
(`just launch-web`)。

```sh
just build-cli        # このマシン向けに ./apps/cli/dist/gemma-e2e をコンパイル
just build-cli-dist   # macOS・Linux・Windows 向けにクロスコンパイル
```

```sh
gemma-e2e scenario list                  # サーバが把握しているすべてのシナリオ
gemma-e2e scenario get login             # 1 つのシナリオとそのケース
gemma-e2e scenario apply scenarios/*.yaml  # YAML から作成または更新
gemma-e2e scenario delete login

gemma-e2e run start login --watch        # シナリオを実行して追跡し、その判定で終了
gemma-e2e run start --prompt "buy a coffee" --title Coffee
gemma-e2e run list                       # 直近の run
gemma-e2e run get <runId>                # 1 つの run とそのケース・ステップ
gemma-e2e run watch <runId>              # 実行中の run を追跡

gemma-e2e models                         # LLM エンドポイントが提供するモデル
gemma-e2e device                         # エミュレータの状態
```

サーバは `--server`、次に `GEMMA_E2E_SERVER`、最後に `http://127.0.0.1:5175` の順で
決まります。`--json` は API の応答をそのまま出力し(`run watch` は 1 行に 1 つの JSON
ドキュメントを出します)、`NO_COLOR`・`--no-color`・TTY でない stdout のいずれかで
色付けが無効になります。

終了ステータスにより、CLI をそのまま CI のゲートとして使えます:

| コード | 意味 |
| --- | --- |
| 0 | コマンドが成功した、または run が passed |
| 1 | run が failed |
| 2 | コマンドを実行できなかった(使い方の誤り・サーバに到達できない・run がエラー終了) |

```sh
gemma-e2e run start checkout --watch || exit $?
```

クロスコンパイルの対象は macOS(arm64 / x64)、Linux(x64 / arm64)、Windows(x64)
です。Alpine などの musl ターゲットはまだビルドしていません。

### CLI の E2E テスト

[pitty](https://github.com/kexi/pitty) はコンパイル済みバイナリを実際の PTY 上で
動かし、出力・終了コード・引数処理を検証します。devshell に含まれているので、別途
インストールする必要はありません。

```sh
just test-cli         # バイナリをコンパイルしてから e2e/scenarios/ を実行
just test-cli-server  # `just launch-web` の起動が必要
just test-cli-models  # `just launch-web` の起動 *と* LM Studio の提供が必要
```

`e2e/scenarios/` はサーバを必要としません。`--help` / `--version`、使い方の誤りと
その終了コード、`--` によるオプションの終端、色付けの抑止、ローカルでのシナリオ
ファイル検証、ダッシュボードに到達できないときの案内を扱います。
`e2e/scenarios/server/` は `:5175` で稼働中のダッシュボードを前提とするので分けて
あり、`just test-cli` はその中に降りません。

そのディレクトリの中でも `models.yaml` はさらに分離され、`just test-cli-models`
だけが実行します。`models` はダッシュボードの先まで届く唯一の読み取り専用コマンド
だからです: `/api/models` は LM Studio をプロキシしており、LM Studio が落ちていると
サーバは 503 を返し、CLI は終了コード 2 で終わります。`just test-cli-server` は
`read-only.yaml` を明示的に指定するので、`just launch-web` だけが動いている状態でも
green のままです。

`just check-all` は意図的にこれらを含めていません — pitty はまずバイナリをコンパイル
する必要があり、他のゲートよりはるかに遅いためです。`apps/cli` を触るときは
`just check-all` と合わせて `just test-cli` を実行してください。

## ドキュメント

- [SETUP.md](SETUP.md) — 開発環境のオンボーディング
- [ARCHITECTURE.md](ARCHITECTURE.md) — 概観とデータフロー
- [knowledge/](knowledge/index.md) — すべての技術的判断を 1 ファイル 1 件で記録(OKF v0.2)

## ライセンス

[MIT](../../LICENSE)
