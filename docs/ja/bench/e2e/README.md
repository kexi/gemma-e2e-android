# 実モデル E2E の証跡取得

English: [../../../../bench/e2e/README.md](../../../../bench/e2e/README.md)

`run.py` は起動済みダッシュボード API を通じて、既存シナリオを1件実行する。
サーバー・モデル・端末の起動、ロード、終了は行わない。呼び出し元で逐次実行する。

準備時に `scenarios/login[.web].yaml` と `shop[.web].yaml` の4ケースをまとめ、
各ケースの `model` に実際のモデル識別子を明記したシナリオを
`var/model-e2e-20260927/scenarios/` に配置する。API の `SCENARIOS_DIR` を
そのディレクトリへ向け、Android または Web の対象アプリを準備する。
ケースID・プロンプト・上限・対象は既存fixtureを保持する。

`fixtures.json` は既存login/shopの入力を転記したもの。
`matrix.py` はモデルを1つずつロードし、4ケースを実行してアンロードする。
開始時に他のモデルがロードされていた場合や、API上のrunが終了していない場合は停止する。

```sh
python3 bench/e2e/matrix.py --platform web --only gemma-4-31B-it-MLX-4bit
```

Androidは専用AVDと現在のソースからビルドしたAPKを使い、結果を別ディレクトリへ保存する。
APIにも同じ `SCENARIOS_DIR` と対象端末の `ANDROID_SERIAL` を設定する。

```sh
python3 bench/e2e/matrix.py --platform android --results bench/e2e/android-results --scenario-dir var/model-e2e-android-20260927/scenarios --sample-memory
python3 bench/e2e/summarize.py --results bench/e2e/android-results --server-log var/model-e2e-android-20260927/server.jsonl
python3 bench/e2e/summarize_memory.py --results bench/e2e/android-results
```

`--sample-memory` はロード後から4ケース終了まで、LM Studio配下のプロセスとその子孫を
1秒間隔で採取する。macOS `proc_pid_rusage` のphysical footprintと `ps` のRSSを、
プロセス別・合算で記録する。モデルロード中、Androidエミュレータ、APIサーバーは含まない。
LM StudioのUI・helperは含み、モデル単体のMetal allocator使用量ではない。
共有ページの重複計上や採取間隔より短いピークを考慮し、サンプル最大値として扱う。
RSS採取失敗、不完全なsummary、または全標本のfootprint欠測があればmatrixを停止する。
短命な子プロセスの終了などで一部のfootprintを取得できない標本は、合算をnullとして除外し、
欠測数を報告する。残った完全標本の最大値であり、連続時間の真のピークではない。

今回のWeb試験は専用プロファイルのHeadless Chrome 153.0.8010.53を使用する。
モデルは画面のDOMテキストを読み、実際のGenkit・CDP・画面遷移を通る。
画像レビュー機能は無効、操作経路の生成設定と再試行はアプリの既定を保つ。
各モデル4ケースを1回ずつ測るスモーク試験で、反復成功率やAndroid実機の保証ではない。

```sh
python3 bench/e2e/run.py --scenario <scenario-id> --model <loaded-model-id> --platform web
```

既定のAPIは `http://localhost:5175`、全体期限は900秒。
開始前にシナリオの4ケースと明示モデルを検査し、終了後にも実際のケースを検査する。
開始前には `fixtures.json` の該当プラットフォームと対象・ケース順・ID・プロンプト・
ステップ上限を照合する。ケース別targetの上書きも同じ対象であることを検査する。
`--platform` を省略した場合はシナリオのtargetから選ぶ。タイトル等の測定用ラベルは照合対象外。
`results/<scenario>-<UTC>/` にシナリオ、開始要求の設定・応答、
最新の完全API応答・run JSON、時間・操作列・判定概要を保存する。
期限切れでも取得済みの部分runを保存し、終了コード1を返す。
サーバー上のrunはキャンセルしないため、次のモデルへ切り替える前に終了を確認する。

モデルによる完走判定と、最後の `finish` ステップのUIテキストによる補助判定を分ける。
UIテキストは操作前の画面なので、画面遷移しない `finish` の入力を使用する。
`finish` がない場合は補助判定を `unavailable` とする。
期待文字列は両プラットフォームのfixture実装に基づく。
共通serializerの1行を解析し、安定IDを持つ要素の `text` を完全一致で比較する。
全文検索・desc属性・入力欄の値は合格根拠にしない。同じIDが重複した場合も不合格とする。

- 正常ログイン：`screenTitle` のショップ名、`signOutButton` 自身またはその子孫のSign out、
  `beanRow-yirgacheffe` 自身またはその子孫のYirgacheffe
- 誤パスワード：`errorMessage` のInvalid email or password
- カート：`screenTitle` のYour cart、`cartLine-yirgacheffe` のQty 1 - $18.00、
  `cartTotal` のTotal: $18.00
- 注文：`screenTitle` のOrder placed!、`orderNumber` のOrder number: KCS-1001

この判定は文字列による補助であり、画面画像の独立した視覚確認は別途行う。
モデル自己判定・ケース構成・補助判定がすべて通ったときだけ終了コード0を返す。

`python3 bench/e2e/summarize.py` は保存済みJSONとローカルサーバーログだけを読み、
`results/aggregate.json` に再集計する。`completed` / `partial` / `timed_out` を区別し、
モデル自己判定とUI補助判定の両方がpassedのケースを `verified_pass_count` に数える。
画像・動画は存在だけを検査し、内容を視覚確認したとは扱わない。
LLMログにはrunIdがないため、逐次実行時の `case.started` ～ `case.finished` とモデル名で
対応付ける。対応が曖昧なイベントは帰属せず、ログがない場合は0回と断定しない。
`recovered_attempts` は後続の `llm.decided` へ回復した失敗試行数、
`recovered_decisions` はその回復が起きた判断の回数である。

`results/genkit-wire-probe.json` は実GenkitLlmのfetchを差し替えた送信形状の検査。
既存compat-oai経路ではHTTP bodyにtool_choiceと各toolのdescriptionが無いことを確認した。
モデル推論・E2E成功数には含めず、直接APIベンチとの条件差として扱う。
