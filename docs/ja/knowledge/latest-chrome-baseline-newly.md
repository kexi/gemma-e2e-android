---
type: Decision
title: "Browser target: latest Chrome, Baseline Newly available, no polyfills"
description: A local development tool has one known browser, so newly available platform features are used directly with @supports and graceful degradation instead of polyfills.
status: stable
tags: [dashboard, browser-support, css, progressive-enhancement]
---

このダッシュボードはローカル開発ツールです。エミュレータ・LM Studio サーバ・
Firestore エミュレータと並んで `localhost` で動き、それらを起動した本人が開き
ます。対象ブラウザは実質 1 つなので、**最新 Chrome** を前提とし、Baseline
**Newly available** の機能 — さらに、フォールバックが「同じ UI の演出が減った版」
で済むなら Chrome 限定の機能まで — をそのまま採用します。

これが脆さにならないよう、2 つの規則を置きます。

- Baseline Widely available でない機能は、必ず `@supports` で囲むか、実行時の
  feature check で守るか、非対応ブラウザが宣言を単に無視しても正しく使える出力
  になるように書く。
- **ポリフィルを入れない。** プラットフォーム API を再実装するものを依存関係に
  加えません。

ワークベンチ UI で得られるもの: run 選択時の方向付き View Transitions、ステップ
タイムラインと実行履歴への `content-visibility: auto` +
`contain-intrinsic-size`、画面外でデバイスのフレーム用ソケットを閉じるための
`contentvisibilityautostatechange`、折り畳んだままでもステップの UI ツリーが
ページ内検索に引っかかる `hidden="until-found"`、開閉アニメーションのための
`interpolate-size: allow-keywords` と `calc-size()`。Firefox や Safari では
いずれも「アニメーションなしで即座に切り替わる、機能的には同等」の挙動に落ちます。

*Why not 一般的な「主要ブラウザの最新 2 バージョン」:* このツールには存在しない
ユーザーのために、ポリフィルかプラットフォーム機能の手書き再実装のどちらかを
払うことになります。ダッシュボードはデプロイされず、未知のブラウザが混じる
アクセスの裾野もありません。

*Why not さらに絞って Chrome 専用・フォールバック一切なしにしないのか:*
`@supports` / feature check の規律はほぼ無償です — フォールバックはたいてい
「何もせずブラウザに素で描かせる」で済みます — し、将来このダッシュボードを別の
マシンに向ける可能性を閉じずに済みます。

*捨てたもの:* Firefox や Safari で撮ったスクリーンショットやデモは実物より
平板に見え、それらのブラウザを使う貢献者はトランジションを目にしません。
どちらもツールの報告内容には影響しません。
