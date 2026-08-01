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

```
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

## 6. ダッシュボード

```sh
just web
```

Hono の API が `http://localhost:5175`、Vite の開発サーバが
`http://localhost:5173` で起動します。ブラウザで開くのは後者です。コミット済みの
シナリオの実行、その場かぎりのプロンプト投入、ステップのライブ表示、実行履歴の
閲覧がここからできます。

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

## 7. 動作確認

```sh
just check
```

lint・フォーマットチェック・型チェック・履歴全体の秘密情報スキャン・Actions の
SHA 固定チェックを実行します(CI と同じゲート)。タスク一覧は `just --list` で
確認できます。

### トラブルシューティング

- **`adb devices` に何も出ない / `unauthorized`** — `adb kill-server && adb start-server` を実行し、端末側で RSA の確認をやり直します。
- **`flake.nix` を編集しても devshell が古いまま** — `direnv reload`。
- **エミュレータが起動しない** — `avdmanager list avd` で AVD の存在を確認し、`just avd-create`(`--force` 付き)で作り直します。
- **Bun で Expo CLI を動かす** — `bunx --bun expo …` を使います。`--bun` がないと `#!/usr/bin/env node` シェバンに従って Node で動きます。
- **フックが動かない** — `just setup`(= `lefthook install`)を実行します。
