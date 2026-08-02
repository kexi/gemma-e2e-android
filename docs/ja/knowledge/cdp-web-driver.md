---
type: Decision
title: "Web ドライバ: Chrome DevTools Protocol を直接叩く(Puppeteer 不使用)"
description: ブラウザは自前の CDP クライアントで駆動し、ページはデバイスと同じ UiNode ツリーとして報告する。
status: stable
tags: [cdp, chrome, driver, dom, adapter]
sources:
  - id: target-schema
    resource: 4e1fe70c89e38f9e04fd1c673e537edb41ecbdb3
    title: Let a scenario say which platform it drives
  - id: driver-interface
    resource: 9d08d8fddd4826c7c0b55f5b1640396cd411f83f
    title: Give the loop a driver instead of an adb client
  - id: dom-walker
    resource: ac6a3f70e8a965a51d0af723ebcee18655712a21
    title: Map a page onto the tree the model already reads
  - id: cdp-client
    resource: fb75692d84a232c8d2d2bb17c34f4c50ccf744b5
    title: Drive Chrome over the DevTools Protocol
verified:
  by: human:kexi
  at: 2026-08-02T21:40:00Z
---

ケースは `target` を宣言し、リゾルバがそれに応じたドライバを開く。Android は
従来どおり `adb`、`web` は CDP で Chrome のページを開く。エージェントループ側
は変わらない — `UiNode` ツリーを読み、モデルに次の 1 手を尋ね、実行する。

*なぜループがブラウザを知らずに済んだか*: ページを uiautomator と同じ
`UiNode` ツリーとして報告しているため。`className` は Android のウィジェット
クラスの位置にタグ名を、`resourceId` は `pkg:id/leaf` の位置に `id` 属性を運ぶ。
シリアライザの 2 つの短縮関数は Web 側の値に対して恒等写像になるので、
`serializeForLlm`・ref の採番・`Action` の語彙・システムプロンプトはいずれも
実装 1 本のまま残った。これが決定的な制約だった: 写像に 2 本目のシリアライザが
必要なら、その後ろに 2 本目のプロンプトと 2 本目のアクション集合が要り、両
プラットフォームが共有するのはループの骨格だけになっていた。

*なぜ Puppeteer / Playwright を使わないか*: 必要なのはダンプ・クリック・
キー入力・スクリーンショットだけ。両者の価値はブラウザ管理・自動待機・
セレクタエンジンにあるが、3 つともループが既に own している責務と重なる —
何を待つかはループが決め、モデルは操作対象をセレクタではなく ref で選ぶ。
Android 側で Appium を退けたのと同じ理由
([ui-capture-uiautomator-dump.md](ui-capture-uiautomator-dump.md))。CDP は素の
JSON-RPC なので、クライアントは id 採番と保留応答の Map とイベントディスパッチャ
を 1 本の WebSocket に載せたものにすぎない。

*なぜ 1 本のソケットで全ページを賄うか*: `flatten: true` でアタッチすると各
メッセージに `sessionId` が付き、ブラウザと配下のページが 1 接続を共有できる。
代替は非推奨の `Target.sendMessageToTarget` エンベロープ。

*なぜケースごとに browser context を作るか*: 破棄すれば cookie・localStorage・
IndexedDB・キャッシュ・パーミッションがまとめて消える。個別に消す方式では
origin を列挙し損ねる余地が残り、前のケースのセッションを引き継いでしまう —
それこそ Android の reset が防いでいる事故そのもの。この設計のおかげで Web の
`reset()` は navigate するだけで済む(直前に作った context なので消すものがない)。

*なぜ `Accessibility.getFullAXTree` ではなく `Runtime.evaluate` か*: AX ツリー
は座標を一切持たないため、ノードごとに `DOM.getBoxModel` を往復するか、
`DOMSnapshot.captureSnapshot` を `backendDOMNodeId` で結合する必要がある。
どちらも experimental で結合も煩雑な一方、`getBoundingClientRect` なら 1 回の
評価で座標とセマンティクスが同時に得られる。

*なぜ collector と写像を分けたか*: collector はページ内で動くので型検査も
単体テストも届かない。解釈できるものはすべて後段の純粋関数側に寄せ、そちらを
徹底的にテストしている。もう半分を happy-dom で代替することはできない —
レイアウトエンジンがないので `getBoundingClientRect` が全部ゼロを返し、
シリアライザがページ全体を画面外として捨ててしまう。rect をスタブしたテストは
存在しないブラウザを固定することになるので、collector 側は実 Chrome に対する
`just cdp-check` で担保する。

*静かに間違う箇所(いずれもテストで固定済み)*:

- マウス入力は press と release の**両方**が要り、`clickCount` も必要。無いと
  イベントは飛ぶのにブラウザが click を合成せず、フォーカスや選択が原因不明に
  おかしくなる。
- Enter の `Input.dispatchKeyEvent` には `text: "\r"` が要る。無いとキー
  イベントは届くのに文字が生成されず、フォームが submit されない。
- ナビゲーションは `load` ではなく `networkIdle` を待つ。SPA は空の殻の状態で
  `load` に達するので、その時点のダンプには操作対象が何も無い。
- フィールドの値は子テキストノードではなくプロパティ。テキストノードだけ読む
  collector はどれだけ入力しても `<input>` を空と報告し、モデルは自分の作業を
  見られなくなる。
- `cursor: pointer` は継承する。ボタン内の `<span>` がすべて pointer になり
  個別の ref を持ってしまうので、「自身が最も近いクリック可能祖先である」要素
  だけを対象とする。
- collector は `String.raw` リテラルなので、コメント内も含めてバッククォートが
  1 つでもあると文字列が閉じ、Chrome には途中で切れたプログラムが届く。

*なぜ 1 文字ずつのキー入力ではなく `Input.insertText` か*: 往復 1 回で済み、
Unicode 安全で、フレームワークが購読している `input` イベントを発火する。キー
イベントは飛ばないので、キー入力を監視するフィールドには `key_event` も必要
だが、それは既にループが「enter を押す」と表現している操作そのもの。

*なぜ `Input.synthesizeScrollGesture` ではなくホイールイベントか*: ジェスチャ
パイプラインは実時間でアニメーションするため、スクロール 1 回ごとに 1 秒近く
消費するうえ headless では不安定。ホイールは即時かつ決定的。

*なぜ Chrome を遅延接続にするか*: ブラウザが起動していないマシンでもダッシュ
ボードは立ち上がり、Web ケースを実行した時点で「どのフラグで起動すればよいか」
を含むメッセージとともに失敗する。`adb` やエミュレータの gRPC エンドポイントと
同じ扱い。
