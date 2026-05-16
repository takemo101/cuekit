# Swarm-lite → Swarm 進化の技術的制約分析

## 問い

「今の cuekit の仕組みで、swarm（auto-steer/wake）に進化するのは技術的に難しいか？」

## 結論

**技術的には「不可能」ではないが、既存アーキテクチャ上の制約が多く、実装コストと複雑性が指数関数的に増大する。**

むしろ「難しい」というより、「**今の設計思想（parent-led delegation substrate）と根本的に矛盾する**」。swarm 化するなら、cuekit のコアを別物に書き換えるに等しい。

---

## 技術的制約の一覧

### 1. プロセスモデルの制約（最大の障壁）

#### 現状
cuekit は **CLI / MCP サーバー** として動作する。
- `cuekit` コマンドを呼ぶ → SQLite を読み書き → 終了
- MCP サーバーも stdio/stdio ベースで、親（AI agent）からのリクエストを待つ

#### swarm 化に必要なもの
auto-steer には「**バックグラウンドでイベントを監視し、条件を満たしたら steer を発火する仕組み**」が必要。

```
必要なアーキテクチャ:
┌─────────────────────────────────────────┐
│  cuekit daemon（常駐プロセス）            │
│  ├─ SQLite イベント監視スレッド           │
│  ├─ 条件判定エンジン（auto-steer ルール） │
│  ├─ steer 実行キュー                      │
│  └─ リトライ・デッドレターハンドラ        │
└─────────────────────────────────────────┘
```

現状の cuekit には「常駐プロセス」という概念がない。`start_team_strategy` も一瞬で終わるコマンドで、coordinator の起動をキックするだけ。

**選択肢:**
- **A) デーモン化する** → `cuekitd` のような常駐プロセスを作る。シグナルハンドリング、クラッシュ復帰、リソース監視が必要
- **B) OS の cron/launchd/systemd に依存** → 1 秒単位のイベント監視には不向き
- **C) 親エージェントに監視を任せる** → 親が `while (true) { get_team_snapshot(); sleep(1); }` を回す。これは既存の親-led モデルの延長だが、親のコンテキストを圧迫

#### 評価
デーモン化（A）は技術的に可能だが、**cuekit の「小さな delegation substrate」という設計思想を破壊**する。デーモンはワークフローエンジンの特徴。

---

### 2. アダプタ層の制約

#### 現状
cuekit の子タスクは外部 CLI（pi, claude, opencode, gemini など）を tmux/zellij/herdr pane で実行する。
- **Interactive タスク**: `tmux send-keys` で steer 可能
- **Batch タスク**: `supports_steering: false`、steer は失敗

#### swarm 化の障壁
auto-steer する対象（coordinator）が batch モードだった場合：

```
worker A が completed
→ システムが coordinator に auto-steer
→ coordinator は batch モード
→ steering_unsupported エラー
→ 誰に報告？どう復帰？
```

**対策とその複雑性:**

| 対策 | 実装コスト | 副作用 |
|---|---|---|
| **coordinator を強制的に interactive にする** | 中 | `start_team_strategy` で `adapter_options.mode: "interactive"` を上書き。しかしユーザーが batch を意図していた場合、意図を無視することになる |
| **batch coordinator は auto-steer 対象外** | 低 | 結果として「auto-steer が効く/効かない」という予測不能な動作。親が「なぜ steer されないのか」を調査する必要がある |
| **steer 失敗時に親に通知** | 高 | 通知インフラ（push, ack, キュー）が必要。これは cuekit の現在の範囲外 |

#### 評価
**batch/interactive の区別**は cuekit の設計上の大きな特徴であり、これを auto-steer が無視するわけにはいかない。結果として「auto-steer 対象外の coordinator」が存在し、**一貫性が崩れる**。

---

### 3. データモデルの制約

#### 現状
`task_events` は append-only。

```sql
create table task_events (
  id text primary key,
  task_id text not null,
  type text not null,
  message text,
  created_at text not null
);
```

イベント発火時に「**同じチームの coordinator は誰か**」を特定するインデックスがない。

#### swarm 化に必要なクエリ

```sql
-- worker が terminal イベントを報告した瞬間、同チームの coordinator を探す
select t.id
from tasks t
join task_teams tt on t.team_id = tt.id
where tt.id = ?
  and t.team_position = 'coordinator'
  and t.status in ('running', 'input_required')
order by t.created_at desc
limit 1;
```

これは**可能**だが、以下の問題がある：
- **coordinator が複数いる場合** → 誰に steer する？全員？最新？
- **coordinator がまだ起動していない場合** → queue に入れておく？
- **coordinator が既に terminal になっている場合** → 誰に報告？

#### 評価
**「誰に steer するか」のルーティングロジック**が必要。これはシンプルに見えて、実際には「coordinator が不在」「coordinator が batch」「coordinator が既に知っている」などのケースが大量に出てくる。

---

### 4. MCP プロトコルの制約

#### 現状
MCP（Model Context Protocol）は**リクエスト/レスポンス型**。
- クライアント（AI agent）がツールを呼ぶ
- サーバー（cuekit）が結果を返す
- **サーバーからクライアントへの push は標準的ではない**

#### swarm 化の障壁
auto-steer は「サーバー側からクライアント（coordinator）にメッセージを送る」動作。

```
現状の MCP フロー:
  クライアント(AI) → MCP サーバー(cuekit) → 結果

swarm 化で必要なフロー:
  cuekit（内部）→ 「worker A が完了しました」→ coordinator（別プロセスの AI）
  
  しかし coordinator は MCP クライアントとして待機していない。
  coordinator は tmux pane 内で独立に動いている。
```

**実現方法とその醜さ:**

| 方法 | 仕組み | 問題 |
|---|---|---|
| **A) tmux send-keys で直接注入** | `tmux send-keys` を cuekit 内部から直接呼ぶ | coordinator が「何をしている途中か」わからず、入力が衝突する可能性。冪等性ゼロ |
| **B) adapter の steer メソッドを内部から呼ぶ** | `runSteerTask` を auto-steer トリガーから直接呼ぶ | 技術的には可能。ただし「システムが勝手に steer する」という挙動になり、親の制御から外れる |
| **C) coordinator に MCP サーバーを持たせる** | coordinator 側にも MCP サーバーを立て、cuekit から通知 | coordinator が「MCP サーバー」を持つ必要がある。pi/claude などの外部 CLI にこれを求めるのは現実的でない |

#### 評価
**MCP は親-led モデルのためのプロトコル**であり、サーバー側からの push を想定していない。auto-steer はこのプロトコルの前提を破る。

---

### 5. 冪等性とエラーハンドリング

#### 現状
`steer_task` は冪等ではない：
- 同じメッセージを 2 回送ると、一部の adapter では「追加入力」として解釈される
- 一部では「意図しない動作」を引き起こす

#### swarm 化の障壁
auto-steer は「イベント発火をトリガーに steer を発行」するため、以下の失敗モードがある：

```
1. worker A が completed（DB 書き込み成功）
2. auto-steer 処理開始
3. 処理中に cuekit プロセスが再起動（デプロイなど）
4. 再起動後、worker A の completed イベントを再検知
5. auto-steer を再発行 → coordinator に同じメッセージが 2 回届く
```

**対策と複雑性:**

| 対策 | 実装 | 副作用 |
|---|---|---|
| **delivery log テーブル** | `auto_steer_deliveries` テーブルを作り、「このイベントは既に steer 済み」を記録 | 新しいテーブル、新しいインデックス、クリーンアップ戦略が必要 |
| **冪等キー** | steer メッセージにイベント ID を含め、coordinator に「重複は無視して」と指示 | coordinator のプロンプトが複雑化。しかし冪等性は保証されない（adapter 次第） |
| **at-least-once + 冪等設計** | delivery log + 冪等キーの組み合わせ | 最も堅牢だが、実装が最大。キューシステムに近づく |

#### 評価
**冪等性なしの steer を auto 化するのは危険**。一度入れると、デッドレター、リトライ、重複排除のフルセットが必要になる。

---

### 6. コンテキスト管理の制約

#### 現状
coordinator は自分のコンテキスト窓の中で動作する。
- 32K モデルでも、system prompt + 過去の会話 + worker の結果 + `submit_team_tasks` の履歴で埋まる

#### swarm 化の障壁
auto-steer は「都合の良いタイミング」ではないタイミングで steer を注入する。

```
 coordinator のコンテキスト:
 [system prompt]
 [過去の wait_team 結果 × 10回 = 10,000 トークン]
 [worker の結果 × 3 = 5,000 トークン]
 [submit_team_tasks の履歴 = 2,000 トークン]
 ───────────────────────────────
 残り: 5,000 トークン（実行中の作業用）
 
 ↓ auto-steer「worker A が完了しました」が突然注入
 
 残り: 4,900 トークン（100 トークンの steer メッセージ）
 しかし coordinator は「今何をしていたか」をコンテキストから探す必要がある
```

auto-steer された coordinator は「**なぜ今 steer されたのか**」を理解する必要がある。これは単なる通知では不十分で、「チーム全体の状態」を再把握するためのコンテキストが必要。

#### 評価
**コンテキスト窓を圧迫する**。auto-steer は軽量な steer メッセージを送るが、coordinator がそれを理解するためには大きなコンテキストが必要。結果として、**auto-steer が頻発すると coordinator の判断品質が低下**する。

---

## 技術的制約のまとめ

| 制約 | 深刻度 | 理由 |
|---|---|---|
| **プロセスモデル（デーモン化）** | 🔴 高 | 常駐プロセスがないとイベント監視ができない |
| **アダプタ層（batch/interactive）** | 🔴 高 | batch coordinator への steer が失敗する |
| **MCP プロトコル（push 不可）** | 🔴 高 | サーバーからクライアントへの通知が標準的でない |
| **冪等性（重複 steer）** | 🟡 中 | 再実行時の重複を防ぐ仕組みが必要 |
| **データモデル（ルーティング）** | 🟡 中 | 「誰に steer するか」のインデックスがない |
| **コンテキスト管理** | 🟡 中 | auto-steer が coordinator のコンテキストを圧迫 |

---

## なぜ「難しい」のではなく「設計思想と矛盾する」のか

技術的制約は「工夫すれば乗り越えられる」。本当の理由は**設計思想**にある。

### cuekit の設計思想

> cuekit は **child-agent delegation substrate** であり、ワークフローエンジンではない。
> — AGENTS.md

この思想の核心：
1. **親エージェントが判断する** — システムは判断しない
2. **子エージェントは観測可能・操作可能** — しかし自律的ではない
3. **primitive は小さく、組み合わせで使う** — 高レベルな抽象化はしない

### swarm 化が矛盾する点

auto-steer は「**システムが判断して子エージェントを動かす**」ため、cuekit の核心を破る。

```
cuekit の範囲:
  親 ──submit──> 子（起動）
  親 ──steer──> 子（介入）
  親 ──wait──>── 結果を受け取る
  子 ──report──> 親（報告）

swarm の範囲:
  システム ──auto-steer──> 子 A（自動介入）
  子 A ──auto-steer──> 子 B（自動介入）
  システム ──auto-wake──> 子 C（自動再開）
```

後者を実現するには、**cuekit を別物に書き換える**必要がある。

---

## 代替案：jcode swarm を参考にする

もし本当に swarm が必要なら、**cuekit を拡張するのではなく、jcode swarm との統合**を検討すべき。

| 機能 | cuekit | jcode swarm |
|---|---|---|
| 常駐デーモン | なし | あり（swarmd） |
| Agent-to-agent DMs | なし | あり |
| 自動 wake/resume | なし | あり |
| Plan DAG | なし | あり |
| ファイル衝突検出 | なし | あり |

**統合案:**
- cuekit は「pane 管理 + adapter 実行 + イベント永続化」の substrate として残す
- jcode swarm が「スケジューリング + auto-steer + agent 間通信」のレイヤーとして cuekit を利用

これは「cuekit を swarm に進化させる」ではなく、「**cuekit を swarm の実行基盤の一部**として使う」方向。

---

## 結論

**技術的には可能だが、設計思想と矛盾する。**

今回の swarm-lite 改善（1A+1B, 2B, 3B）は、あくまで「**親-led の範囲内で coordinator-led チームを実用的にする**」ための整備。これを超えて「システムが自動で動かす」方向に進むと、cuekit は別物になる。

もし将来、swarm-lite の検証で「**親-led では不十分**」というエビデンスが出た場合：
1. まず jcode swarm との統合を検討
2. それでも不十分なら、cuekit v1 で swarm モードを追加（opt-in、デフォルト無効）
3. しかしそれは「進化」ではなく「別のプロダクト」に近い

**今は swarm-lite を完璧にすることに集中する。**
