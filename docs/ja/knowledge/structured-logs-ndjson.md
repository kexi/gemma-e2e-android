---
type: Decision
title: "Structured logs: NDJSON on stderr, validated by Zod"
description: Every runtime log line is one Zod-validated JSON object on stderr.
status: stable
tags: [logging, zod, ndjson]
sources:
  - id: logger
    resource: 056847a8ab81c7da956faf10273776a291af7feb
    title: Unify runtime output on Zod-validated NDJSON logs
---

実行時のログは 1 行 1 JSON として stderr に出力します。共通の骨格は固定で、
`ts`(ISO 8601)・`level`(`debug`/`info`/`warn`/`error`)・`event`(`run.step`
`adb.exec_failed` `http.request` のようなドット区切りの名前空間)を必ず持ち、
イベント固有の構造化フィールドをそこに並べます。`LogEvent` スキーマと
`createLogger` は `@gemma-e2e/logger` が持ち、`child()` で `runId` などの
コンテキストを束ねると以降の全行に伝播します。

ライブラリは自分からは書きません。`packages/adb`・`packages/agent`・Hono アプリ
はいずれも `logger` を受け取り、既定は no-op です。出力の可否はプロセスの
エントリポイント 1 箇所だけが決めます。テストでは収集用の sink を注入するだけで
発行イベントを検証できます。

*なぜ stdout でなく stderr か:* stdout はコマンド本来の出力の場所であり、結果を
`jq` に流したときにログまで飲み込まれてはいけないためです。

*なぜ pino や winston を使わないか:* 目的である「Zod による検証」は既に満たして
おり、残りは JSON 1 行とレベル絞り込みだけだからです。*なぜ検証失敗で例外に
しないか:* ログのフィールド不備で実行を止める価値はないため、不正なイベントも
そのまま出力し、直前に該当パスを示す `log.invalid_event` 警告を出します。開発中は
気づけて、本番では無害です。
