# クイックセットアップ

English: [../../QUICK-SETUP.md](../../QUICK-SETUP.md)

リポジトリをクローンしてすぐ試したい人向けに、`git clone` からダッシュボードで
シナリオを動かすまでの最短手順をまとめています。うまくいかないときや詳しく知りたい
ときのために、各手順から [SETUP.md](SETUP.md) の該当箇所へリンクしています。

## 始める前に（マシンごとに 1 回）

1. **flakes を有効にした Nix、direnv、nix-direnv**。direnv をシェルにフックしておきます
   — [SETUP.md §1](SETUP.md)。
2. **LM Studio**（GUI アプリで、Nix では管理しません）と `lms` CLI。
   <https://lmstudio.ai/> からインストールし、`~/.lmstudio/bin/lms bootstrap` を実行します
   — [SETUP.md §4](SETUP.md)。
3. **Google Chrome**。Web のシナリオで使います。

## 手順

```sh
git clone https://github.com/kexi/gemma-e2e-android
cd gemma-e2e-android
direnv allow             # 初回は Android SDK とエミュレータのイメージを取得(数 GB、10 分以上)
just install-deps        # JavaScript の依存
cp .env.example .env     # LLM_MODEL などの設定。既定値のままで動きます

# 初回だけ
just launch-llm          # LM Studio のローカル API を起動
just get-model           # Gemma 4 26B-A4B QAT(MLX)を取得(約 16 GB)
just create-avd          # gemma-e2e-api35 エミュレータを作成

# 毎回
just launch-all
```

`just launch-all` は、実行に必要なものを 1 つのターミナルでまとめて起動します。
モデルを読み込んだ LM Studio、サンプルアプリ入りのエミュレータ、ブラウザ版サンプル
アプリ、Chrome、ダッシュボードです。初回は Android アプリのビルドがあるため数分
かかります。既に動いているものは飛ばすので何度実行しても安全で、Ctrl-C 1 回で自分が
起動したものだけを止めます。

`up; dashboard at http://localhost:5173` と表示されたら <http://localhost:5173> を開き、
左のサイドバーでシナリオを選んで再生ボタンを押します。

## うまくいかないとき

- **`lms` が見つからない** — LM Studio の CLI がまだ PATH にありません。上の手順 2 を
  確認してください。
- **ポートが使用中** — 5173、5174、5175、8081、8790、9222 のどれかを別のプロセスが使って
  います。`launch-all` は既に待ち受けているポートを飛ばすので、そのプロセスを止めるか、
  その部分だけ自分で起動してください。
- **そのほか** — [SETUP.md](SETUP.md) で各部分を 1 つずつ説明しています。最後に
  トラブルシューティングもあります。
