---
type: Decision
title: SSE stays; Firestore listeners are a later option
description: The dashboard follows runs over an in-process event bus, with Firestore used purely for persistence.
status: stable
tags: [sse, firestore, dashboard]
sources:
  - id: dashboard
    resource: e0ca7be5d719ac7fbd82869150877868fcbe7dce
    title: Add the web dashboard so runs are driven and read from a browser
  - id: firestore
    resource: 1b7eb616f74a32eab55cc6f464bce14e3f83666e
    title: Model scenarios as bundles of cases, and persist runs in Firestore
---

ダッシュボードは引き続き、プロセス内の `RunEventBus` が発行する SSE で run を追跡し、
Firestore は永続化専用です。イベントには `caseId` が付き、クライアントは各ステップを
正しいケースに振り分けられます。

*なぜブラウザを Firestore のリアルタイムリスナーに直結しないか:* Firebase の資格情報を
クライアントへ配り、現在は全拒否のセキュリティルールを開ける必要があるのに対し、
得られるのは数十行のバスの削除だけだからです。別プロセスが開始した run を追う必要が
出たら再検討します — それこそが Firestore への移行で可能になったことです。
