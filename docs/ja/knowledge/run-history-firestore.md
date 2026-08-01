---
type: Decision
title: "Run history: Firestore plus files"
description: Step logs and verdicts live in Firestore; screenshots and recordings stay on disk.
status: stable
tags: [firestore, storage, history]
sources:
  - id: firestore
    resource: 1b7eb616f74a32eab55cc6f464bce14e3f83666e
    title: Model scenarios as bundles of cases, and persist runs in Firestore
  - id: sqlite-original
    resource: 9a605b48b22b69e5e465e86bb4aeca2b1e1aecc4
    title: Implement core, adb, agent, and store packages
  - id: recording
    resource: b9a357ce01eed01b4e792a5ffe3341ed65012b51
    title: Record each test case to video so failures can be replayed
---

ステップログと判定結果は Firestore に、ドメインをそのままドキュメント階層に写した
形(`runs/{runId}` → `cases/{caseId}` → `steps/{index}`)で保存します。
スクリーンショットとケース単位の画面録画はファイルのままで、パスをドキュメントに
持ちます。開発と CI は
ポート 8790 の Firestore エミュレータ、プロジェクト ID は `demo-gemma-e2e` を
使います。`demo-` 接頭辞が付いていると firebase-tools は Google へ一切接続せず、
完全オフラインで動きます。

階層がドメインと一致しているため、1 ケース分のタイムラインの取得はフラットな
テーブルへの絞り込みではなく、1 つのサブコレクションへの 1 クエリで済みます。
ステップのドキュメント ID はゼロ埋めした index(`000007`)で、Firestore の辞書順が
そのままステップ順になり、別途 `orderBy` 用フィールドを同期する必要がありません。

*なぜ SQLite(置き換え前)をやめたか:* 単一のローカルファイルはマシン間でも将来の
ホスト版ダッシュボードとも共有できず、履歴がテストを回したノート PC に閉じ込め
られます。Firestore ならエミュレータによって「設定不要のローカル開発」を保ったまま、
共有デプロイへの道が開けます。移行時に store のコードは変わらず、
`FIRESTORE_EMULATOR_HOST` が無くなるだけです。

*なぜ DB に blob を入れないか:* Firestore のドキュメント上限は 1 MiB で、課金も
読み取り単位です。スクリーンショットはその両方を破綻させます。
