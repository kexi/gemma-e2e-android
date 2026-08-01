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
[nix-direnv](https://github.com/nix-community/nix-direnv) を導入し、シェルに
フックします(`direnv hook fish | source`、`eval "$(direnv hook bash)"` など)。

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
bun install
```

`bunfig.toml` で `minimumReleaseAge = 86400` を設定しているため、公開から 1 日
未満の npm パッケージは拒否されます。これでインストールが失敗した場合は単に
新しすぎるので、待つか `minimumReleaseAgeExcludes` に個別に追加してください。

## 4. LM Studio と Gemma

LM Studio は GUI アプリのため Nix 管理外です。

1. [LM Studio](https://lmstudio.ai/) をインストールし、設定から `lms` CLI を
   有効にします。
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

## 6. 動作確認

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
