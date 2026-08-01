---
type: Decision
title: A generic Zod converter, validating in both directions
description: One converter turns any Zod schema into a FirestoreDataConverter that parses on write as well as read.
status: stable
tags: [firestore, zod, validation]
sources:
  - id: firestore
    resource: 1b7eb616f74a32eab55cc6f464bce14e3f83666e
    title: Model scenarios as bundles of cases, and persist runs in Firestore
---

`packages/store` の `zodConverter(schema, label)` は任意の Zod スキーマを Firestore
の `FirestoreDataConverter` に変換し、全コレクションがこれを通ります。重要なのは
読み取りだけでなく**書き込み時にも** parse することです。

*なぜ書き込み時も検証するか:* Firestore はスキーマレスであり、型システムが「ある」と
信じているフィールドを実際に保証するのは実行時チェックだけです。不正なドキュメントを
書き込み時点で弾くからこそ、読み取り側は検証失敗を「日常的に起こること」ではなく
「本物の破損」として扱えます。保存されるのは Zod の出力なので、未知のキーは除去され
デフォルトが適用され、ディスク上のドキュメントはスキーマと厳密に一致します。

ドキュメントはパスが既に表している情報(`runId` / `caseId` / `index`)を持ちません。
読み出し時にドキュメント ID から復元します。*なぜ二重に持たないか:* 同じ事実の
コピーが 2 つあれば、いずれ食い違うからです。

*なぜタイムスタンプを Firestore `Timestamp` でなく ISO 8601 文字列のままにするか:*
JSON API・SSE ペイロード・ダッシュボードのいずれも既に ISO 文字列を話すため、
`Timestamp` にすると境界ごとに変換が必要になる割に得るものがありません。この store が
実行するクエリはドキュメント ID 順か文字列フィールド順であり、ISO 8601 はどちらでも
正しくソートされます。
