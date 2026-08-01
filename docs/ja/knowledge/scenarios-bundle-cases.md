---
type: Decision
title: "The domain: scenarios bundle test cases"
description: A case is what earns a verdict; a scenario only groups and orders cases.
status: stable
tags: [domain, scenarios, cases, model-resolution]
sources:
  - id: cases
    resource: 1b7eb616f74a32eab55cc6f464bce14e3f83666e
    title: Model scenarios as bundles of cases, and persist runs in Firestore
---

**テストケース**は、1 つの判定を得る自然言語のゴールです(例:「間違った
パスワードでエラーが出ることを確認」)。**シナリオ**は、対象アプリと(多くの場合)
モデルを共有するケースの束です。判定を持つのはケースであり、シナリオはそれらを
まとめて順序づけるだけです。

```
   Scenario (scenarios/login.yaml)
   ├─ id, title, app?, model?
   └─ cases: TestCase[]            (1 つ以上・宣言順に実行)
      ├─ TestCase { id (slug), title?, prompt, model?, maxSteps=20 }
      └─ TestCase { … }

   シナリオ 1 回の実行:

   Run  { id, scenarioId, title, status, verdictReason, startedAt, finishedAt }
   └─ CaseRun { caseId, order, title, prompt, model, status, verdictReason,
      │          videoPath, … }
      └─ Step { index, action, uiText, screenshotPath, note, createdAt }
```

**モデル解決**は `case.model ?? scenario.model ?? LLM_MODEL` で、`packages/core`
の `resolveModel` が算出し `CaseRun` に保存します。後から設定を変えても、履歴には
「実際に動いたモデル」が残ります。

*なぜケース単位でモデルを選べるか:* 明白なハッピーパスは軽いモデルで十分な一方、
難しい判定には大きなモデルが要ることがあります。run 単位でモデルを固定すると、
束全体を最も遅い選択に引きずられます。

*なぜケースを逐次実行するか:* 1 台のデバイスを共有するため、並列にすると 2 つの
ケースのタップが混線します。各ケースは開始前にアプリを force-stop してから起動し
直します。プロセスが生きたまま `am start` すると前のケースが残した画面が復帰し、
ナビゲーション履歴とログイン状態を引き継いでしまうためです。

*なぜ 1 件失敗しても続行するか:* ケースを束ねる目的は、1 回の実行で全件について
知ることだからです。run が `passed` になるのは全ケースが passed のときだけです。
