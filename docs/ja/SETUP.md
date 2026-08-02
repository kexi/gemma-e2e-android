# セットアップ

開発環境のオンボーディング手順です。LM Studio 以外の CLI ツールはすべて
`flake.nix` に宣言してあるため、Nix・direnv・LM Studio デスクトップアプリ以外に
手動インストールするものはありません。

English: [../../SETUP.md](../../SETUP.md)

## 1. 前提: Nix と direnv

flakes を有効にした Nix をインストールします。
[Determinate Systems のインストーラ](https://github.com/DeterminateSystems/nix-installer)
なら flakes が最初から有効になります。

```sh
curl --proto '=https' --tlsv1.2 -sSf -L https://install.determinate.systems/nix | sh -s -- install
```

既存の Nix を使う場合は `~/.config/nix/nix.conf` に次を入れてください。

```text
experimental-features = nix-command flakes
```

続いて [direnv](https://direnv.net/) と
[nix-direnv](https://github.com/nix-community/nix-direnv) を導入します
(nix-direnv が devshell をキャッシュするので、ディレクトリに入るのが一瞬に
なります)。

```sh
# macOS(Homebrew)
brew install direnv nix-direnv
# または Nix 自体で
nix profile install nixpkgs#direnv nixpkgs#nix-direnv
```

シェルにフックします:

```sh
# fish: ~/.config/fish/config.fish
direnv hook fish | source

# zsh: ~/.zshrc          # bash: ~/.bashrc
eval "$(direnv hook zsh)"
```

`~/.config/direnv/direnvrc` で nix-direnv を読み込みます:

```sh
# Homebrew の場合
source "$(brew --prefix)/share/nix-direnv/direnvrc"
# nix profile の場合
source "$HOME/.nix-profile/share/nix-direnv/direnvrc"
```

## 2. devshell に入る

```sh
direnv allow
```

初回は Android SDK・platform-tools・エミュレータの system image をダウンロードする
ため **数 GB・10 分以上かかります**。2 回目以降は一瞬です。

direnv を使わない場合は `nix develop -c` を前置きしてください
(例: `nix develop -c just check`)。

devshell に入ると `lefthook install` も実行されるので、pre-commit フック
(gitleaks / pinact / oxlint / oxfmt)は自動で有効になります。

## 3. JavaScript の依存を入れる

```sh
just install    # = bun install
```

`bunfig.toml` で `minimumReleaseAge = 86400` を設定しているため、公開から 1 日
未満の npm パッケージは拒否されます。これでインストールが失敗した場合は単に
新しすぎるので、待つか `minimumReleaseAgeExcludes` に個別に追加してください。

## 4. LM Studio と Gemma

LM Studio は GUI アプリのため Nix 管理外です。

1. [LM Studio](https://lmstudio.ai/) をインストールし、`lms` CLI をセットアップ
   します — 手順は [lms CLI ガイド](https://lmstudio.ai/docs/cli) を参照
   (`~/.lmstudio/bin/lms bootstrap` で PATH に追加されます)。
2. `gemma-4-12b` モデルをダウンロードします。メモリが厳しい場合は E4B を使います。
   `.env` の `LLM_MODEL` には `lms ps` が表示する値を設定してください。これは
   `case.model → scenario.model → LLM_MODEL` の最後のフォールバックで、モデルを
   指定していないシナリオはこの値で動きます。
3. OpenAI 互換サーバを起動します。

   ```sh
   just llm    # = lms server start
   ```

エージェントは `http://localhost:1234/v1` に接続します。base URL を変えれば
mlx-lm や Ollama に差し替えられます。

## 5. エミュレータまたは実機

```sh
just avd-create   # gemma-e2e-api35 AVD(Android 35 / arm64-v8a)を作成
just emu          # ヘッドレス起動
adb devices       # エミュレータが見えることを確認
```

実機を使う場合は、開発者オプション → USB デバッグを有効にして接続し、RSA の
確認ダイアログを承認すると `adb devices` に現れます。

デバイスかエミュレータが見えたら、example アプリをビルドして導入します:

```sh
just android      # = expo run:android(prebuild(CNG)→ ビルド → インストール)
```

初回は `android/` の生成と Gradle 依存のダウンロードで時間がかかります。
2回目以降は差分ビルドです。

## 5b. Chrome(Web シナリオ用)

`web` を target に持つシナリオは、Chrome を DevTools Protocol 経由で駆動します。
必要なプロセスは 2 つ — テスト対象のアプリと、デバッグポートを開いたブラウザ。

```sh
just example-web  # ブラウザ版の Coffee Shop → http://localhost:5174
just chrome       # Chrome --remote-debugging-port=9222
```

`just chrome` は `$TMPDIR` 以下に専用プロファイルを作るので、既に起動している
Chrome を閉じる必要はありません — 既定プロファイルを共有する 2 つ目のインスタンス
はポートを開いてくれないためです。別の方法で起動したブラウザを使う場合は
`CHROME_ENDPOINT` をそちらに向けてください。

ダッシュボードの起動自体には何も要りません。ドライバは初回使用時に接続するので、
Chrome が無ければ Web のケースが「どのフラグで起動すればよいか」を含むメッセージ
とともに失敗するだけです。失敗するのはそのケースだけで、run の残りは続行します。

`just cdp-check` はサンプルアプリを実際のクライアントで駆動し、モデルが読む
ツリーを表示します。ページ内で動くため単体テストが届かない DOM collector を
検証できる唯一の手段なので、`packages/cdp` を触ったあとに実行する価値があります。

## 6. Firestore エミュレータ

実行履歴は Firestore に保存します。開発中に本物の Google プロジェクトへ触れることは
ありません。エミュレータはプロジェクト ID `demo-gemma-e2e` でローカル起動し、
`demo-` 接頭辞のおかげで資格情報も課金アカウントも不要な完全オフライン動作になります。

```sh
just db     # Firestore エミュレータを 127.0.0.1:8790 で起動
```

`just web` がこれも起動するため、単体レシピが要るのは API サーバを手で動かすときだけ
です。ポートは `firebase.json`、プロジェクト ID は `.firebaserc` にあります。
エミュレータ本体は firebase-tools が初回に取得する Java プログラムで、再起動をまたいで
データを保持しません(`just db` のたびに空の DB から始まります)。

接続する側には次の 2 つの環境変数が必要です(`just web` と `just test` は自動で
設定します)。

```sh
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8790
export GOOGLE_CLOUD_PROJECT=demo-gemma-e2e
```

`firestore.rules` はクライアントからの読み書きを全拒否しています。これは意図的です。
書き込むのはダッシュボードのサーバプロセスが使う Admin SDK だけで、Admin SDK は
ルールを迂回します。ブラウザからこのプロジェクトを覗こうとすると、履歴が漏れる
のではなく明確に失敗します。

## 7. ダッシュボード

```sh
just web
```

3 つのプロセスが起動します — Firestore エミュレータ(`127.0.0.1:8790`)、Hono の
API(`http://localhost:5175`)、Vite の開発サーバ(`http://localhost:5173`)。
ブラウザで開くのは最後のものです。コミット済みシナリオの実行、モデルを選んでの
その場かぎりのプロンプト投入、ケースごとのステップのライブ表示、実行履歴の閲覧が
ここからできます。左レールの **New scenario** はシナリオビルダーを開き、
`scenarios/<id>.yaml` を書き出します。git 管理下のファイルなのでコミットは別途
必要で、同名のファイルが既にある場合は上書きせず拒否します。

### デバイスのライブビュー

**Device** ページでエミュレータの画面をライブで確認できます。実行中の run では
ステップのタイムライン横に同じビューが埋め込まれ、エージェントの操作をその場で
見られます。フレームはエミュレータの gRPC ブリッジ経由で届くため、エミュレータ側
でこれを有効にしておく必要があります(`just emu` が `-grpc 8554` を渡すのはこの
ためです)。このフラグなしで起動したエミュレータでも adb とシナリオ実行は動作し、
ライブビューだけが表示されなくなります(画面上にその旨が出ます)。

フレームは画面が変化したときだけ届くので、静止しているデバイスでは静止画のまま
になります(停止ではありません)。ビューは表示専用です。接続できない場合は
`just mirror` でダッシュボードとは独立に scrcpy で同じ画面を開けます。別の
ブリッジを見せたいときは `EMULATOR_GRPC=host:port` を指定します。

`LIVE_VIEW=web` を指定すると、同じページが Chrome を映すようになります(録画と
同じ screencast を使用)。ライブビューは 1 つだけなので、実行中のシナリオから
導出するのではなく設定で選ぶ形にしています。run が駆動していないときにどこを
映すかは `LIVE_VIEW_URL` で指定します。ブラウザ側のビューは run が作るページを
共有せず専用のページを開きます — run のページはケース終了時に context ごと
破棄されるためです。

### 画面録画

各ケースは scrcpy で最初から最後まで録画され、次の場所に保存されます。

```text
var/videos/{runId}/{caseId}.mp4
```

ケースが終了すると run ページのアコーディオン内にプレーヤーが現れるので、
ライブで見ていなかった失敗もあとから再生できます。同じ仕組みがエミュレータでも
実機でも動き、録画時間の上限はありません。

録画は既定で有効で、事前準備は不要です(scrcpy は devshell に含まれています)。
無効にするには `.env`(または環境変数)で `RECORD_RUNS=0` を指定します。いずれに
してもベストエフォートで、scrcpy が起動できなければ run はそのまま録画なしで続行し、
サーバは `record.failed` をログに出し、そのケースの `videoPath` は null のままです。

Web のケースも録画されますが、経路は異なります。CDP には動画キャプチャが無いため、
ページの screencast フレームを `ffmpeg` で mux します。scrcpy と同様 `flake.nix`
で宣言済みなので devshell が用意し、インストール作業は不要です。レコーダは `PATH`
(または設定されたパス)から `ffmpeg` を解決するので他の入れ方でも動きますが、
確実なのは devshell です。scrcpy より画質は劣り、速いスクロールではフレームが
落ちますが、保存先は同じでダッシュボードでも同じように再生できます。

`var/` は gitignore 済みなので録画がコミットに入ることはありません。run が生成する
成果物の中では最も容量を食うので、ディスクが厳しいときは `var/videos/` を削除して
ください。

## 8. 動作確認

```sh
just check
```

lint・フォーマットチェック・型チェック・テスト・履歴全体の秘密情報スキャン・
Actions の SHA 固定チェックを実行します。タスク一覧は `just --list` で確認できます。

`just test` は `bun test` を `firebase emulators:exec` で包むため、Firestore の
テストにはテストと同時に起動・終了する使い捨てエミュレータが割り当てられ、`just db`
のデータには一切触れません。素の `bun test` にはエミュレータが無いので、該当テストは
失敗ではなく skip され、実行結果にスキップ数として出ます。

### トラブルシューティング

- **`adb devices` に何も出ない / `unauthorized`** — `adb kill-server && adb start-server` を実行し、端末側で RSA の確認をやり直します。
- **`flake.nix` を編集しても devshell が古いまま** — `direnv reload`。
- **エミュレータが起動しない** — `avdmanager list avd` で AVD の存在を確認し、`just avd-create`(`--force` 付き)で作り直します。
- **Bun で Expo CLI を動かす** — `bunx --bun expo …` を使います。`--bun` がないと `#!/usr/bin/env node` シェバンに従って Node で動きます。
- **フックが動かない** — `just setup`(= `lefthook install`)を実行します。
- **`firebase-tools no longer supports Java version before 21`** — エミュレータ用レシピが `$FIREBASE_JAVA_HOME/bin` を `PATH` に前置しているのはこのためです(devshell の既定 JDK は AGP が必要とする 17)。`firebase` を直接叩く場合も同様に `PATH="$FIREBASE_JAVA_HOME/bin:$PATH" firebase …` としてください。
- **ポート 8790 が使用中** — 以前の `just db` が残っています。停止するか `firebase.json` のポートを変更します。
- **Firestore のテストが全部 skip される** — 素の `bun test` を実行しています。エミュレータを用意する `just test` を使ってください。
