---
type: Measurement
title: スクショとペルソナによる視覚アクセシビリティレビュー
description: Gemma への画像送信とペルソナ別出力を検証した。定性的な候補抽出であり、見え方の再現や適合判定ではない。
status: draft
tags: [llm, tool-calling, measurement]
generated: { by: codex, at: 2026-09-22T07:16:37Z }
verified:
  - { by: process:local-tests, at: 2026-09-22T02:12:07Z }
  - { by: process:just-check, at: 2026-09-22T02:17:39Z }
  - { by: process:just-check, at: 2026-09-22T07:16:37Z }
stale_after: 2026-12-22T00:00:00Z
sources:
  - id: transport
    resource: ../packages/agent/src/accessibility.test.ts
    title: 実 HTTP transport、出力検証、タイムアウトの自動テスト
  - id: runner
    resource: ../packages/agent/src/run.test.ts
    title: Android/Web adapter とレビュー実行・証跡保存・失敗分離の自動テスト
  - id: persistence
    resource: ../packages/store/src/store.test.ts
    title: Firestore エミュレーターでのペルソナ・指摘の保存往復
  - id: live
    resource: "2026-09-22、ローカル MLX google/gemma-4-26b-a4b-qat、既存 Android ログイン画像1枚、red-green/presbyopia の2ペルソナ"
    title: 実モデルの画像入力スモークテスト
  - id: vision
    resource: https://ai.google.dev/gemma/docs/core/model_card_4
    title: Gemma 4 model card
---

# 評価範囲

画面に表示された文字・色・形・配置に対する定性的な問題候補を抽出する。
ペルソナの視覚を物理的に再現しているわけではない。コントラスト比、実際の文字サイズ、
WCAG 適合は測定していない。スクリーンリーダー、読み上げ順序、代替テキスト、
キーボード操作は対象外。モデルの画像理解対応だけでは、この用途の精度は保証できない。[^vision]

# 証跡の対応

**2026-09-22 点検時の訂正:** 以下は初期実装の順序。画像評価の待ち時間でUI参照が古くなる不具合が
再現したため、現在は操作前に画像だけ保存し、操作と操作後画像の取得を終えてから評価する。
操作判断が失敗したときは評価を実行しない。初期実装の記録は経緯として残す。

既存 `Step.uiText` は操作前、`Step.screenshotPath` は操作後。
レビュー用に操作前の `NNN-review.png` を別途取得し、結果にそのパスとペルソナ定義・モデルを保存する。
初期画面と finish 判断の画面も評価する。操作判断そのものが失敗して Step が作られない場合は、
先に実施したレビューも Step として保存されない。全過渡状態の網羅検査ではない。[^runner]

# 検証したこと

- 実 Genkit/compat-oai transport の HTTP body に PNG data URL と全ペルソナが入る。
- 要求したペルソナと出力の ID が一対一で一致しない場合はエラーになる。
- 無応答の場合は期限で実 HTTP 接続を abort する。
- 大きすぎるレポートは UTF-8 JSON 128 KiB 上限で拒否する。
  フィールドごとの文字数だけでは、8ペルソナ×20指摘の日本語で約2.4MBになり得るため。
- Firestore エミュレーターでレビューの snapshot と指摘が保存・再読込できる。
- 画像取得・画像評価の失敗を通常の E2E 合否と分けて保存する。[^transport][^runner][^persistence]

最終 `just check` は843テスト成功、型検査・lint・整形・秘密情報・action pin・knowledge検査が成功。
Web本番ビルドも成功。実Chromeのfixtureでカスタム条件の保存・再編集、ケース単位OFF/継承、
候補あり/候補なし/エラー/未評価の表示を確認した（実デバイスからの取得はfixture化）。

# 実モデルで見つかった問題

モデル `google/gemma-4-26b-a4b-qat`（MLX、15.64GB、`lms ps` 表示 context=262144/parallel=4）へ
既存 Android ログイン画面を送り、赤緑・老眼の2ペルソナを一度に評価した。
初回は37,575msで型検証を通るレポートを返したが、指摘はソフトウェアキーボードに集中した。
アプリ側では変更できないOS表示なので、プロンプトにキーボード・ステータスバー等の除外を追加した。
除外追加直後の1回は専用tool callを返さず、正しく評価エラーとして検出された。[^live]

最終版（OS領域除外、temperature=0、形式不正時の再試行あり）は同じ画像・2ペルソナで
14,811msで型検証を通るレポートを返し、両ペルソナとも指摘なしだった。
キーボードへの指摘は出なかったが、これを画面のアクセシビリティ適合とは解釈しない。[^live]

この少数試行は画像入力の疎通確認であり、検出精度・再現性・他モデルの性能の証明ではない。
Android/Web実機を操作する一連のE2Eと画像評価を組み合わせた実測は未実施。

# compat-oai の注意点

compat-oai 1.40.1 の HTTP body を捕捉したテストでは、Genkit の `toolChoice: "required"` だけでは
HTTP の `tool_choice` に反映されなかった。画像レビュー側は `config.tool_choice: "required"` も
指定し、実 body をテストで検証する。過去の tool call 成功計測は成功率の記録であり、
このパラメータが transport で送信されたことを示すものではない。[^transport]

同バージョンは falsy な設定値を除去するため `temperature: 0` も落ちる。
レビュー専用 fetch で送信JSONに0を復元し、HTTP bodyで確認する。
形式不正時だけ最大2試行とし、2試行全体で60秒の期限を共有する。
接続失敗やHTTPエラーの自動再試行は行わない。[^transport]

# 2026-09-22 追加点検で修正した不具合

- 画像評価中に画面が変わると、その前に取得したUI参照で誤った場所を操作し得た。
  fake画面を評価中に期限切れにするテストで操作失敗を再現した。
  操作前画像は維持し、評価だけを操作・操作後撮影より後へ移動して回帰テストを通した。[^runner]
- 壊れた tool arguments JSON は compat-oai 内の `JSON.parse` が先に例外を投げるため、
  外側のレポート検証に到達せず再試行が働かなかった。
  実HTTP stubで「不正JSON→正常応答」の失敗を再現し、SyntaxErrorを形式失敗へ変換して修正。
  HTTP 503は1リクエストで終了することも確認した。スキーマ不正と未知tool名は元から再試行できていた。[^transport]
- HTTPの巨大なエラー本文が `review.error` に入り、成功レポートの128KiB制限を迂回していた。
  日本語60万文字で約1.8MBの保存データになること、空のError.messageはスキーマ不適合になることを再現。
  保存前に4,096 UTF-16 code unitで短縮し、空には既定文を補い、同じ短縮内容をログへ出す。[^runner]
- 設定保存後の一覧再取得が遅いと、ダイアログが古いpropsから再編集を開始していた。
  Chromeの遅延API fixture（再取得1.5秒）で保存済みペルソナ条件が旧値へ戻ることを再現。
  保存応答を一時保持し、開く時に最新値からフォームを再構成する。
  連続保存の再取得が逆順で届く場合も、Sidebarで最新リクエストの応答だけを採用する。
  修正後は30秒遅延fixtureで、再取得前の再編集と、二回目保存後に初回の旧snapshotが届く条件を確認した。
  二回目の条件が維持された。Chromeが同じURLへのGETを待機させたため、実ネットワークのR2→R1順は未検証。

追加点検後の `just check` は850テスト成功。UIの追加修正後も型検査・lint・整形チェック成功。

[^transport]: packages/agent/src/accessibility.test.ts。ローカル HTTP stub を使用し、本物のモデル精度は検証しない。
[^runner]: packages/agent/src/run.test.ts。実 adapter + fake device/model。
[^persistence]: packages/store/src/store.test.ts。`just test` による一時 Firestore エミュレーター。
[^live]: 実モデルをローカルサーバー経由で呼出し。画像は `var/screenshots/3d606917-a302-4284-b8e6-645f42609dd5/valid-credentials/000.png`。
[^vision]: Google の Gemma 4 model card。
