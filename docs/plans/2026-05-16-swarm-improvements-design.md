# Swarm-lite 改善設計検討（2026-05-16）

## 検討対象

1. **coordinator が worker 完了を自動感知できない** → 親のポーリング負担が大きい
2. **blackboard（team_events）が受動的** → 書いたが誰も読まない
3. **attention items が coordinator の異常を隠す** → blocked/help_requested が見えない

各問題について、cuekit の設計境界（workflow engine にしない、auto-steer/wake は v0 外）を守りつつ改善するアプローチを比較検討する。

---

## 問題 1: coordinator の worker 完了感知

### 現状

coordinator は自ら `wait_team(follow_new_tasks)` でポーリングループを回すか、親が `get_team_snapshot` → `steer_task(coordinator)` で介入する必要がある。coordinator が待機中に何もせず終了したり、ポーリング間隔が不適切だったりすると、チームが宙に浮く。

### アプローチ比較

| # | アプローチ | 概要 | 設計境界との関係 | トレードオフ |
|---|---|---|---|---|
| 1A | **強化 coordinator prompt + 自動 parent_session 設定** | `start_team_strategy` で coordinator を `long_lived: true` / `timeout_ms: null` に自動設定し、プロンプトに「`wait_team(follow_new_tasks)` をループし、全 terminal になるまで待機する」という明示的レシピを含める | v0 内。prompt-only。既存 primitive の組み合わせ | 実装最小。しかし coordinator が従わない場合は依然として親の介入が必要 |
| 1B | **Team event sequence + wait 最適化** | team snapshot に `latest_event_sequence` を追加。`wait_team` に `resume_after_sequence` パラメータを追加し、「指定 sequence より新しい event が発生するまで待機」をサポート。coordinator は軽量ポーリングで「何か起きた」だけを検知し、snapshot で詳細を読む | v0 内。効率化のみ。auto-steer ではない | 親が steer する回数は減るが、coordinator 自身が wait を呼ぶ必要は残る |
| 1C | **Auto-steer coordinator（worker terminal 時）** | worker が terminal イベントを報告した瞬間、システムが自動的に同じチームの coordinator に steer（「worker X が完了しました。次のアクションを決定してください」）を注入する | v0 外に近い。設計境界を超える | coordinator が常に steer を受けることになる。batch タスクの場合 `steering_unsupported` で失敗する可能性も高い |
| 1D | **Team state change watermark + coordinator 定期 snapshot** | team 行に `event_sequence` カウンターを追加。coordinator は短間隔で `get_team_status` を呼び、sequence が変わったら snapshot を読む。wait ではなく snapshot ベース | v0 内。ただし DB 書き込みが増える | wait_team の semantic を崩さないが、効率的な「何か起きたか」の検知が可能 |

### 推奨案: 1B + 1A（ハイブリッド）

**Phase 1: Prompt + Lifecycle 設定の強化（1A）**
- `start_team_strategy` が coordinator タスクを自動的に `long_lived: true` に設定
- coordinator prompt に明示的な待機ループレシピを注入:
  ```
  1. submit workers with submit_team_tasks
  2. loop { wait_team(follow_new_tasks, timeout_ms: 60000) }
  3. if all workers terminal → submit reviewer or report completion
  4. if blocked/stalled → steer affected task or report blocked
  5. never exit until all non-coordinator tasks are terminal
  ```

**Phase 2: Sequence-aware wait（1B）**
- `task_events` に team-scoped sequence counter を追加（`team_sequence`）
- `wait_team` に `since_team_sequence?: number` を追加
- 内部実装: `runWaitTasks` を呼ぶ前に `team_sequence` をチェックし、新イベントがあれば即座に返す（wait なし）
- coordinator はループ内で `wait_team(..., since_team_sequence: lastSeq)` と呼び、イベント発生まで実質ブロックできる

これにより、coordinator は「能動的に待機」を続け、親の介入は最小限に抑えられる。

### なぜ Auto-steer（1C）を避えるか（設計根拠）

#### 1. 制御の主体

cuekit v0 の「workflow engine ではない」という制約は、機能の有無ではなく「**制御の主体が誰にあるか**」という問いである。

| 観点 | Prompt + Wait 最適化（1A+1B） | Auto-steer（1C） |
|---|---|---|
| **判断主体** | coordinator が自ら wait を呼び出す | システムが判断し、coordinator に注入 |
| **親の関与** | 親は team snapshot を見て判断 | 親は結果を見るだけ |
| **失敗責任** | coordinator の wait 呼び出し失敗 → 親が steer で介入 | システムの steer 失敗 → デバッグ困難 |
| **予測可能性** | coordinator の transcript に「wait を呼んだ」記録がある | システムが裏側で steer → 再現困難 |

auto-steer は「システムが coordinator の判断を代行する」ため、**workflow engine の最小構成要素**になる。一度入れると、次の拡張（「worker failed 時も steer しよう」「reviewer 完了時に finisher 自動起動」）に抵抗できなくなる。

#### 2. Batch タスクとの根本的な衝突

現実の cuekit チームでは coordinator が batch モード（`supports_steering: false`）になるケースがある。

```
worker terminal → システムが coordinator に auto-steer
                  → coordinator は batch モード
                  → steering_unsupported エラー
                  → 誰に報告する？親？無視？
```

- **A) 親に報告する** → 親が介入するなら、最初から親が snapshot を見て判断すればよい
- **B) 無視して次の worker を待つ** → coordinator は「何か起きた」ことを知らないまま次の wait を続行
- **C) batch モードの coordinator は auto-steer 対象外にする** → 条件分岐が複雑化し動作が予測不能に

Prompt + Wait 最適化では、この問題は存在しない。coordinator が自ら wait を呼ぶかどうかは、batch/interactive の能力に依存せず、**prompt 指示の範囲**である。

#### 3. 「都合の良いタイミング」問題

auto-steer は worker が terminal になった瞬間に発火するが、これが常に coordinator にとって都合の良いタイミングとは限らない。

```
t0: worker A が completed を報告
t1: システムが coordinator に auto-steer「A が完了しました」
t2: worker B が 2秒後に completed を報告
t3: システムが coordinator に auto-steer「B が完了しました」
```

coordinator は t1 と t3 で **2 回 steer を受け**、コンテキスト窓を 2 回消費する。本来なら t3 まで待って「A と B が完了しました」と 1 回で済むケースもある。

Prompt + Wait 最適化（`since_team_sequence`）では：

```
t0: coordinator が wait_team(since_sequence=100) を呼ぶ
t1: A が completed（sequence=101）
t2: B が completed（sequence=102）
t3: wait が「sequence > 100 のイベントあり」で即座に返る
t4: coordinator が snapshot を読み、A+B 完了を 1 回のコンテキストで把握
```

**「イベント発生の検知」と「実際の処理」を分離できる**ため、coordinator のコンテキストを節約できる。

#### 4. 冪等性とデバッグ

Steer は**冪等ではない**。同じメッセージを 2 回送ると一部の adapter では意図しない動作を引き起こす。

auto-steer では、再実行時に「worker A completed」を再検知して steer を 2 回発行するリスクがある。Prompt + Wait では、coordinator が自ら `wait` を呼ぶため、**「wait が返った回数 = 処理した回数」**という対応関係が明確になり、再実行しても since_sequence により重複検知が自然に防げる。

#### 5. 「見かけ上の魅力」と「実装コスト」の乖離

| 項目 | auto-steer（1C） | Prompt + Wait（1A+1B） |
|---|---|---|
| auto-steer 発火条件の定義 | 高（completed のみ？failed も？blocked も？） | 不要 |
| steer 失敗時のリトライポリシー | 高（冪等性担保が必要） | 不要 |
| batch モード coordinator の除外ロジック | 中（条件分岐の複雑化） | 不要 |
| 無限ループ防止 | 高（steer → イベント → auto-steer...） | 不要 |
| 親が無効化したい需要への対応 | 高（フラグ設計、設定システム拡張） | 不要 |
| coordinator prompt に wait ループ記述を追加 | 不要 | 低 |
| `long_lived: true` の自動設定 | 不要 | 低 |
| `since_team_sequence` パラメータ追加 | 不要 | 中 |

**auto-steer の 80% の価値を、20% の複雑性で実現できる**のが 1A+1B である。

#### 6. 妥協案の限界

Prompt + Wait では coordinator が wait を「忘れる」リスクがある。しかし、これは親が `get_team_snapshot` で検知・手動介入できる設計で補う。auto-steer を入れると、同様の検知がシステム内部に隠蔽され、**親の介入ポイントが失われる**。

#### 7. 将来の安全な auto-steer（v1+ で検討）

以下の条件を満たす場合のみ、将来検討可能と位置づける：
- 対象が coordinator に限定（worker 同士ではない）
- coordinator が interactive モードであることが確認できる（batch では発火しない）
- steer の内容が「通知」に限定（具体的な指示ではなく「状態が変わりました」という事実のみ）
- 親が明示的に有効化（opt-in、デフォルト無効）
- steer 頻度のレート制限

これは「coordinator の待機効率を上げる支援機能」として位置づけられ、workflow engine 化のリスクを抑えられる。ただし、これは**「wait の欠点が実運用で明確になった後」の拡張**として設計すべきである。現時点では 1A+1B で十分な仮説がある。

### 8. トークン消費の観点からの分析

#### 現状の `follow_new_tasks` の動作

`wait-team.ts`の実装を追うと、`follow_new_tasks: true`の場合：

```ts
const timeoutMs = teamWaitDefaults.timeout_ms ?? 300_000;  // 5分
const pollIntervalMs = teamWaitDefaults.poll_interval_ms ?? 2_000;  // 2秒
const deadline = Date.now() + timeoutMs;
for (;;) {
    wait = await waitCurrentTeamTasks(ctx, input, team, 0, pollIntervalMs);  // timeout_ms: 0
    latest = listTasksByTeam(ctx.db, team.id);
    if (wait.done || Date.now() >= deadline) break;
    await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
}
```

`timeout_ms: 0` で `runWaitTasks` を呼ぶため、**内部のポーリングループは1回の snapshot 取得後、即座に `timed_out: true` で返る**。外側ループで 2 秒 sleep して繰り返す。5 分間で最大 150 回の内部ポーリングが発生する。

しかし **MCP レスポンスは 1 つだけ**。最後の `wait`（最後のポーリング結果）と `latest`（最後のタスクリスト）から `WaitTeamOutput` を構築して返す。

#### レスポンスサイズの内訳

`WaitTeamOutput` は以下を含む：

- `tasks: WaitTaskSnapshot[]` — 各タスクの `task_id`, `status`, `terminal`, `last_event_at`, `last_transcript_at`, `idle_ms`, `attention_hint`, `result`, `events`
- `run_summary: TeamRunSummary` — `attention_items`（最大 10 件）, `manual_steer_hints`, `open_attention`, `observability`（files_read, files_written, diagnostics）, `positions`（各 position の最新 5 イベント要約）

タスク数を N とすると、1 回の `wait_team` レスポンスはおおよそ：

| 要素 | 推定トークン数 |
|---|---|
| tasks（N タスク、events なし） | 100N〜200N |
| run_summary（positions + attention） | 300〜800 |
| **合計（N=5 の場合）** | **800〜1,800 トークン** |
| **合計（N=10 の場合）** | **1,300〜2,800 トークン** |

coordinator が以下のように待機ループを回す場合：

```
while (!all_done) {
    result = wait_team(timeout_ms=60000, follow_new_tasks=true)
    // 60秒後、1,000〜2,000トークンのレスポンスが返る
    // これがコンテキスト履歴に蓄積される
}
```

10 回のループで **10,000〜20,000 トークン**がコンテキストに蓄積される。32K モデルでも system prompt + 過去の会話 + worker の結果 + `submit_team_tasks` の履歴などを含めると、**数回の wait でコンテキスト窓の半分を消費する**。

#### 問題の本質

現状の `wait_team` は「**変化があってもなくても、毎回全タスクの snapshot を返す**」。これは以下のパターンで無駄が大きい：

- Worker が長時間実行中（数分〜数十分）の間、coordinator は何度も `wait_team` を呼び、毎回「全タスク running」の snapshot を受け取る
- 1 つの worker が completed しても、他の worker が running の間は「1 つ completed + 4 つ running」の snapshot を毎回受け取る
- イベントが全く発生していない 60 秒間でも、同じサイズのレスポンスが返る

#### `since_team_sequence`（1B 案）による解決

`task_events` に team-scoped sequence counter（`team_sequence`）を追加し、`wait_team` に `since_team_sequence?: number` を追加すると：

```ts
// coordinator の使用例
let lastSeq = 0;
while (!allDone) {
    const result = await wait_team({
        team_id: "tm_123",
        timeout_ms: 60000,
        follow_new_tasks: true,
        since_team_sequence: lastSeq,
    });
    if (result.team_sequence) lastSeq = result.team_sequence;
    // 変化がなければ極めて軽量なレスポンスが返る
}
```

内部実装では：
1. `team_sequence` をチェック
2. `since_team_sequence` より大きいイベントが存在しない場合 → 軽量レスポンスを返す：
   ```json
   {
     "timed_out": true,
     "team_sequence": 100,
     "status": "running",
     "tasks": [],
     "run_summary": { "terminal_reports": 0, "positions": { ... } }
   }
   ```
   この場合、レスポンスは **100〜200 トークン**に圧縮できる
3. イベントがある場合のみ、従来通りの詳細レスポンスを返す

これにより「変化なし」の wait 呼び出しのトークン消費を **1/10〜1/50** に削減できる。

#### Auto-steer（1C）とのトークン消費比較

| 観点 | Prompt + Wait（1A+1B、since_team_sequence あり） | Auto-steer（1C） |
|---|---|---|
| **変化なし時** | 軽量レスポンス（100〜200 トークン/60秒） |  steer なし（0 トークン） |
| **worker completed 時** | 詳細レスポンス（変化あり、1,000〜2,000 トークン） | 軽量 steer（50〜100 トークン）× worker 数 |
| **コンテキスト蓄積** | `wait_team` 履歴が蓄積されるが、変化なし時は軽量 | steer 履歴が蓄積されるが各 steer は軽量 |
| **まとまった判断** | 複数 worker の完了を 1 回のレスポンスで把握可能 | worker ごとに個別 steer → まとめて判断できない |

結論として：
- **Auto-steer は変化なし時のトークン消費で勝る**（0 vs 100〜200 トークン）
- **しかし `since_team_sequence` 付き Wait でも「変化なし時」は十分軽量**（100〜200 トークンは許容範囲）
- **Auto-steer の方が「変化あり時」も軽量**だが、worker ごとの個別 steer は coordinator の判断を分散させ、コンテキスト窓の断片化を招く
- **`since_team_sequence` 付き Wait は「まとまった判断」ができ、coordinator が「今何が起きているか」を 1 回のコンテキストで把握できる** — これは auto-steer の「断片的な steer」よりも実用的

#### 推奨：1B（`since_team_sequence`）を必須とする理由

現状の `wait_team(follow_new_tasks)` では、**トークン消費が実用上許容できないレベル**にある。`since_team_sequence` なしで coordinator-led チームを運用すると、数回の wait でコンテキストが圧迫され、coordinator が早期の worker 結果を忘却する。

よって：
- **Phase 1（1A）** は prompt + `long_lived` 自動設定のみで「正しく wait ループを回す」ことに集中
- **Phase 2（1B）** は `since_team_sequence` を必須として実装し、トークン消費問題を解決
- Phase 1 だけでは coordinator のコンテキストが現実的に不足するため、**Phase 1 と Phase 2 は同じリリースに含めるか、または Phase 1 の prompt に「コンテキストが大きくなったら get_team_result で要約を読む」という回避策を含める**

---

## 問題 2: Blackboard（team_events）が受動的

### 現状

`report_team_event` で `team_events` テーブルに書き込めるが、実行中のタスクには自動配信されない。worker A が blocker を報告しても、worker B は `get_team_snapshot` を自発的に呼ばないと知らない。

### アプローチ比較

| # | アプローチ | 概要 | 設計境界との関係 | トレードオフ |
|---|---|---|---|---|
| 2A | **Prompt guidance + snapshot 読み込み推奨** | coordinator/worker prompt に「意思決定前に team snapshot / blackboard を確認せよ」と明記。配信機構は追加しない | v0 内。純粋に prompt | 実装ゼロ。しかし実行中のタスクが自発的に読む保証はない |
| 2B | **Steer 時 blackboard 自動添付** | `steer_team` / `steer_task` に `include_blackboard?: boolean` オプションを追加。true の場合、直近の team_events を steer メッセージに自動追記。coordinator が worker を steer する際に「共有事実」を運べる | v0 内。steer の機能拡張 | auto-steer ではなく、既存の steer 操作を強化する形。coordinator が steer する意思決定は人間/親の責任のまま |
| 2C | **Pull-based team event inbox** | 新しい MCP 操作 `get_team_events_since({ team_id, since_sequence })` を追加。各タスクが自ら自分の「未読」イベントを poll する。ack なし、配信 queue なし | v0 内。read model の追加 | worker/coordinator 双方が polling 負担を増やす。ただし `since_sequence` により効率的 |
| 2D | **Auto-broadcast steer on team event** | team event 報告時に、同チームの全 non-terminal タスクに自動 steer を発行 | v0 外。明確な auto-steer | 配信保証があるが、batch タスクに失敗し、ノイズが大きい可能性がある |

### 推奨案: 2B（Steer 時 blackboard 添付）+ 2A（Prompt 強化）

**理由:**
- cuekit の哲学（親/coordinator 主導、auto-steer なし）に最も合致
- 新しいインフラ（delivery queue, ack, subscription）が不要
- coordinator が「誰に何を伝えるか」を判断できる（位置づけとして coordinator の役割そのもの）

**実装:**
```ts
// steer_team / steer_task に追加
interface SteerTeamInput {
  // ...existing fields...
  include_blackboard?: boolean; // 直近 N 件の team_events を steer メッセージ末尾に追記
  blackboard_event_types?: TeamEventType[]; // フィルタ（finding, blocker, decision...）
}
```

**prompt 強化:**
coordinator prompt に以下を追加:
```
When steering workers, use include_blackboard: true to share recent team findings/blockers.
Before submitting new tasks, check the team blackboard via get_team_snapshot for context that may affect task scope.
```

**将来拡張（Phase 3 以降）:**
`get_team_events_since`（2C）を追加し、長時間実行中の worker が自発的に context refresh できるようにする。ただし v0 では steer-based 配送が主たる手段とする。

### Blackboard 添付の実装詳細（深掘り）

#### 実装位置

`steer_team` と `steer_task` の両方に `include_blackboard` を追加する。`steer_task` では対象タスクが属する team の blackboard を添付する。

```ts
// steer_team.ts
export const SteerTeamInputSchema = z.object({
  team_id: z.string().min(1),
  message: z.string().min(1),
  position: TeamPositionSchema.optional(),
  task_ids: z.array(z.string().min(1)).min(1).optional(),
  reason: z.string().min(1).optional(),
  // 追加
  include_blackboard: z.boolean().optional().describe(
    "When true, append recent team blackboard events to the steering message."
  ),
  blackboard_event_types: z
    .array(TeamEventTypeSchema)
    .optional()
    .describe("Filter blackboard events by type. Defaults to all types when omitted."),
  blackboard_limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe("Maximum number of blackboard events to include. Defaults to 5."),
});
```

```ts
// steer_task.ts（task が team に属する場合）
export const SteerTaskInputSchema = z.object({
  task_id: z.string().min(1),
  message: z.string().min(1),
  reason: z.string().min(1).optional(),
  // 追加
  include_blackboard: z.boolean().optional(),
  blackboard_event_types: z.array(TeamEventTypeSchema).optional(),
  blackboard_limit: z.number().int().min(1).max(20).optional(),
});
```

#### イベント取得ロジック

```ts
function buildBlackboardAttachment(
  db: Database,
  team_id: string,
  options: {
    event_types?: TeamEventType[];
    limit?: number;
  },
): string | undefined {
  const limit = options.limit ?? 5;
  const events = listTeamEvents(db, team_id)
    .filter((e) => !options.event_types || options.event_types.includes(e.event_type))
    .slice(-limit);

  if (events.length === 0) return undefined;

  const lines = [
    "",
    "---",
    "[Team Blackboard — Recent Context]",
    ...events.map((e) => {
      const pos = e.position ? `[${e.position}] ` : "";
      return `- ${pos}${e.event_type}: ${e.message}`;
    }),
    "---",
  ];
  return lines.join("\n");
}
```

`runSteerTeam` / `runSteerTask` 内で、対象 task の `team_id` を解決し、`buildBlackboardAttachment` を呼び出して `input.message` の末尾に追記する。

#### トークン消費の見積もり

Blackboard 添付のトークン消費：

| 要素 | 推定トークン数/件 |
|---|---|
| event_type + position プレフィックス | 5〜10 |
| message（平均 100 文字） | 25〜50 |
| **合計/件** | **30〜60 トークン** |
| **5 件添付時** | **150〜300 トークン** |
| **10 件添付時** | **300〜600 トークン** |
| **20 件添付時** | **600〜1,200 トークン** |

**制限の理由:**
- steer メッセージ自体が 100〜500 トークンであることを考慮
- blackboard 添付が steer メッセージより大きくなると、coordinator の意図が埋もれる
- **デフォルト 5 件**は「重要な context を共有しつつ、steer の主メッセージを圧倒しない」バランス
- **上限 20 件**は「緊急時に多くの context を共有する」ための安全弁

#### フィルタリング戦略

デフォルトでは全イベントタイプを含めるが、coordinator が特定のタイプのみを伝えたい場合の例：

```ts
// blocker と finding のみを伝えたい場合
steer_team({
  team_id: "tm_123",
  message: "Please re-check the auth flow implementation.",
  include_blackboard: true,
  blackboard_event_types: ["blocker", "finding"],
  blackboard_limit: 3,
});
```

これにより：
- **ノイズ抑制**: `decision`（coordinator の方針決定）が不要な場合は除外できる
- **緊急度に応じた絞り込み**: 緊急時は `blocker` のみ、振り返り時は `finding` + `review_result`
- **コンテキスト窓節約**: 不要なイベントタイプを除外して steer メッセージを短縮

#### Prompt 強化の詳細

**Coordinator prompt に追加:**

```
## Team Blackboard Usage

The team blackboard is a shared append-only log of important findings, blockers, decisions, and review results.

When steering workers:
1. Use `include_blackboard: true` to share relevant context that affects the worker's task.
2. Filter by event type when appropriate: `blackboard_event_types: ["blocker", "finding"]` for urgent issues.
3. Keep `blackboard_limit` small (default 5) unless the worker needs extensive context.

When to include blackboard:
- A worker is blocked and needs to know about a blocker from another worker.
- You're steering a worker whose task scope overlaps with a recent finding.
- You want to share a decision that affects multiple workers.

When NOT to include blackboard:
- The steer message is already self-contained.
- The worker's task is isolated and unrelated to recent team events.
- The blackboard contains sensitive information that the worker doesn't need.
```

**Worker prompt に追加:**

```
## Team Blackboard Awareness

If you receive a steer message with a "[Team Blackboard]" section, read it carefully. It contains recent findings or blockers from other team members that may affect your work.

If you discover something that other workers should know:
1. Report it via `report_task_event` as usual.
2. If it's team-level (not just your task), also use `report_team_event` with type "finding" or "blocker".
```

#### `get_team_events_since`（2C）との関係

`include_blackboard` は「coordinator が steer する際に context を運ぶ」手段。しかし、以下のケースでは不足：

1. **長時間実行中の worker**: 1 時間実行中の worker が、30 分前に報告された blocker を知る必要があるが、coordinator が steer しない限り届かない
2. **Self-directed worker**: coordinator の介入なしに、worker が自発的に blackboard を確認したい場合

`get_team_events_since` はこれらを解決：

```ts
// 新しい MCP 操作（Phase 3）
interface GetTeamEventsSinceInput {
  team_id: string;
  since_sequence?: number; // 前回読んだ sequence より後だけ取得
  event_types?: TeamEventType[];
  limit?: number;
}
```

**使用パターン:**
```ts
// Worker が定期的に blackboard を確認
let lastSeq = 0;
setInterval(async () => {
  const events = await get_team_events_since({
    team_id: "tm_123",
    since_sequence: lastSeq,
    limit: 10,
  });
  if (events.length > 0) {
    lastSeq = events[events.length - 1].sequence;
    // 新しいイベントを処理
  }
}, 60000);
```

**ただし v0 では:**
- `get_team_events_since` は追加せず、`include_blackboard` のみ提供
- Worker の「自発的な blackboard 確認」は prompt レベルで推奨（`get_team_snapshot` で blackboard セクションを読む）
- 実運用で「worker が blackboard を自発的に読まない」問題が顕在化したら 2C を検討

---

## 問題 3: Attention items が coordinator の異常を隠す

### 現状

`buildTeamAttentionItemsFromEvents` に以下のコードがある:
```ts
if (task.team_position === "coordinator") return [];
```

これにより、coordinator が `blocked` や `help_requested` になっても attention_items に現れず、親が気づきにくい。

### アプローチ比較

| # | アプローチ | 概要 | トレードオフ |
|---|---|---|---|
| 3A | **フィルター完全撤廃** | coordinator も通常通り attention items に含める | coordinator の terminal report（completed）も attention に入る。ノイズの可能性 |
| 3B | **Non-terminal coordinator のみ含める** | coordinator の `blocked`, `help_requested` は含めるが、`completed`/`failed`（terminal）は除外する | ノイズを抑えつつ、coordinator の異常は検知できる。最も実用的 |
| 3C | **Coordinator attention を別フィールドに分離** | `attention_items`（worker/reviewer/finisher 用）と `coordinator_attention`（orchestration 用）を分ける | API 変更が大きい。TUI も両方表示する必要がある |
| 3D | **Severity-based ランキング** | attention item に `severity` を追加。coordinator の blocked は `high`、worker の completed は `low`。上位 N 件だけを表示 | スキーマ変更とランキングロジックが必要 |

### 推奨案: 3B（Non-terminal coordinator のみ含める）

**理由:**
- 実装変更が最小（1 行のフィルター条件を修正するだけ）
- 既存の attention_items consumer（TUI, snapshot, run_summary）に影響を与えない
- coordinator の「詰まり」だけが surface され、正常終了はノイズにならない

**実装:**
```ts
// 修正前
if (task.team_position === "coordinator") return [];

// 修正後
if (task.team_position === "coordinator") {
  // terminal report types (completed/failed) from coordinator are not attention items
  // but blocked/help_requested from coordinator ARE important
  if (!["blocked", "help_requested"].includes(event.type)) return [];
}
```

---

## 実装優先順位（推奨）

### Immediate（v0.0.12 向け）
1. **問題 3（3B）**: 1 行修正で大きな可観測性向上
2. **問題 1（1A）**: coordinator prompt + `start_team_strategy` の `long_lived` 自動設定

### Short-term（v0.0.13 向け）
3. **問題 1（1B）**: `team_sequence` + `since_team_sequence` wait 最適化
4. **問題 2（2B）**: `steer_team` / `steer_task` の `include_blackboard`

### Medium-term（設計検討継続）
5. **問題 2（2C）**: `get_team_events_since`（pull-based inbox）
6. **問題 1（1D 相当）**: Team-level watermark の DB 効率化

---

## 設計境界への影響評価

| 機能 | workflow engine 化リスク | auto-steer リスク | 判定 |
|---|---|---|---|
| coordinator prompt 強化 + long_lived 自動設定 | なし | なし | v0 内 |
| team_sequence + since_team_sequence wait | なし | なし。wait の効率化のみ | v0 内 |
| steer 時 blackboard 添付 | なし | なし。steer の機能拡張のみ | v0 内 |
| coordinator blocked を attention に含める | なし | なし。集計ロジック修正のみ | v0 内 |
| auto-broadcast steer on team event | あり | **高** | v0 外 |
| auto-steer coordinator on worker terminal | あり | **高** | v0 外 |

## 結論：swarm-lite から swarm への進化はしない

### 現状の設計が swarm-lite の範囲内に収まる理由

今回の改善（1A+1B, 2B, 3B）は、いずれも **既存 primitive の強化・効率化** であり、**新しい自動化レイヤー**ではない。

| 改善項目 | 技術的に何をしているか | swarm-lite / swarm のどちらか |
|---|---|---|
| **1A: coordinator prompt + long_lived 自動設定** | `start_team_strategy` の実装詳細を調整。coordinator に「wait をループしろ」と教える | **swarm-lite** — システムは教えるだけ、動かさない |
| **1B: `since_team_sequence` wait 最適化** | `wait_team` のレスポンスサイズを最適化。DB query の条件を追加 | **swarm-lite** — wait は coordinator が呼ぶ。システムは勝手に steer しない |
| **2B: `include_blackboard`（steer 時添付）** | `steer_team` のメッセージ構築時に team_events を追記。steer の機能拡張 | **swarm-lite** — steer は親/coordinator が明示的に呼ぶ。auto-broadcast ではない |
| **3B: coordinator blocked を attention に含める** | `buildTeamAttentionItemsFromEvents` のフィルター条件を 1 行修正 | **swarm-lite** — 集計ロジックの修正。新しい自動挙動はない |

### swarm 化の判定基準と今回のギリギリ

**swarm 化の赤線**は「**システムが判断して agent を動かす**」こと。今回の改善はこの線を跨いでいない：

```
┌─────────────────────────────────────────────────────────────┐
│  改善案                                                     │
│  ├─ 1A: prompt + long_lived 自動設定                        │
│  │     → coordinator に「ループしろ」と教えるだけ ❌swarm   │
│  ├─ 1B: since_team_sequence wait 最適化                     │
│  │     → wait のレスポンスを小さくするだけ ❌swarm           │
│  ├─ 2B: include_blackboard                                │
│  │     → steer メッセージに context を追記するだけ ❌swarm  │
│  └─ 3B: coordinator attention 修正                         │
│        → 集計で coordinator も含めるだけ ❌swarm            │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ これらが swarm 化するには以下が必要：               │   │
│  │ 1. worker terminal → coordinator に auto-steer    │   │
│  │ 2. team event → 全タスクに auto-broadcast steer   │   │
│  │ 3. 自動 finisher 起動                              │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### むしろ「swarm-lite の仮説検証」を強化する

今回の改善の本質は：**swarm-lite の設計が実用上機能するかどうかを、より厳密に検証する**。

- 現状の `wait_team(follow_new_tasks)` はトークン消費が大きく、coordinator が実用的に使えない → **swarm-lite が「使えない」と判断されるリスク**
- `since_team_sequence` で wait を効率化すれば、coordinator は自律的に待機・判断を続けられる → **swarm-lite が「使える」と証明される**
- この検証ができてから、「swarm-lite では不十分」というエビデンスが出た場合に swarm 化（auto-steer）を検討できる

### 設計境界との関係

| 境界 | 今回の改善 | 判定 |
|---|---|---|
| **workflow engine 化しない** | システムは判断しない、coordinator/親が判断する | ✅ 守っている |
| **auto-steer/wake は v0 外** | auto-steer は入っていない | ✅ 守っている |
| **agent-to-agent 通信なし** | steer は親/coordinator → task のみ | ✅ 守っている |
| **delivery queue / ack なし** | blackboard は steer 時の添付のみ、push なし | ✅ 守っている |

### まとめ

今回の改善は **「swarm-lite を実用的にするための整備」** であり、**「swarm-lite を swarm に進化させる改変」ではない**。

むしろ、swarm-lite の範囲内で coordinator-led チームが機能するかどうかを検証し、その結果に基づいて将来 swarm 化を検討する——という順序を守るための改善である。

### Q1: `team_sequence` の migration 戦略

**問題:** `task_events` に `team_sequence` カラムを追加する場合、既存イベント（過去のチームのイベント）はどうするか？

**選択肢:**

| 戦略 | 実装 | トレードオフ |
|---|---|---|
| **A) 新規チームのみ** | Migration でカラム追加、デフォルト NULL。`team_sequence` は NULL の場合「古いイベント」として扱い、`since_team_sequence` 指定時には常に「変化あり」と見なす | 最も単純。既存チームでは `since_team_sequence` の効果がない（毎回詳細レスポンス） |
| **B) 既存イベントにバックフィル** | Migration スクリプトで、既存の `task_events` をチームごとに `created_at` 順に sequence を振り直す | 既存チームでも最適化が効く。ただし migration が重い（全イベントを更新） |
| **C) team_events テーブルに分離** | 新しい `team_events` テーブル（既存とは別）に `team_sequence` を持つ構造を作る。旧テーブルは読み取り専用 | 既存データに影響なし。ただし 2 つのテーブルを管理する複雑性 |

**推奨: A（新規チームのみ）**

理由：
- cuekit はまだ v0 で、既存チームの数は少ない（主に dogfood 用）
- `team_sequence` の主要な受益者は「今後作られる coordinator-led チーム」
- 既存チームで `since_team_sequence` が効かなくても、従来通りの動作になるだけ（機能退行なし）
- Migration スクリプトの複雑性を避けられる

**実装:**

```sql
-- migration
alter table task_events add column team_sequence integer;
create index idx_task_events_team_sequence on task_events(team_id, team_sequence);
```

```ts
// team_sequence の採番（appendTaskEvent 内）
function getNextTeamSequence(db: Database, team_id: string): number {
  const row = db.prepare(
    "select max(team_sequence) as max_seq from task_events where team_id = ?"
  ).get(team_id) as { max_seq: number | null };
  return (row.max_seq ?? 0) + 1;
}
```

```ts
// wait_team 内での「変化なし」判定
function hasNewTeamEvents(
  db: Database,
  team_id: string,
  since_team_sequence?: number,
): boolean {
  if (since_team_sequence === undefined) return true; // 常に詳細レスポンス
  const row = db.prepare(
    "select max(team_sequence) as max_seq from task_events where team_id = ? and team_sequence is not null"
  ).get(team_id) as { max_seq: number | null };
  if (row.max_seq === null) return true; // 古いチーム（sequence なし）
  return row.max_seq > since_team_sequence;
}
```

---

### Q2: `include_blackboard` の際のイベント履歴サイズ

**問題:** 直近 5 件？10 件？タイムウィンドウ（直近 30 分）？

**検討:**

| 方式 | メリット | デメリット |
|---|---|---|
| **件数制限（デフォルト 5、上限 20）** | 予測可能。トークン数が安定 | 古い重要なイベントが落ちる可能性 |
| **タイムウィンドウ（直近 30 分）** | 直近の context にフォーカス | 実行時間の長いタスクでは「重要だが古い」イベントが含まれない |
| **件数 + タイムウィンドウのハイブリッド** | 柔軟 | 複雑。予測困難 |
| **重要度ランキング** | 最も有用なイベントを優先 | ランキングロジックの設計が難しい |

**推奨: 件数制限（デフォルト 5、上限 20）**

理由：
- **予測可能性**: coordinator が「どの程度の context が運ばれるか」を事前に把握できる
- **トークン安定性**: `5 件 × 50 トークン = 250 トークン`と見積もりやすい
- **シンプルさ**: 実装・テスト・ドキュメントが最小
- **手動で調整可能**: 緊急時に `blackboard_limit: 20` とすれば多くの context を共有できる

**将来の拡張（v1+）:**
- 件数制限で足りないケースが出たら、「最後に steer してからの全イベント」というオプションを追加検討
- ただし「最後の steer 時刻」の追跡が必要になり、複雑性が増す

---

### Q3: coordinator の `blocked` を attention に含めた時の TUI 表示

**問題:** `buildTeamAttentionItemsFromEvents` で coordinator の `blocked` を含めると、TUI の attention 表示がどう変わるか？

**検討:**

現状の `TeamAttentionItem` の構造：
```ts
{
  sequence: number;
  task_id: string;
  position?: TeamPosition;  // "coordinator" が入る可能性
  type: "completed" | "failed" | "blocked" | "help_requested";
  reason: "terminal_report" | "help_requested";
  message?: string;
  message_preview?: string;
  steer_target: { task_id: string; event_sequence: number };
}
```

**TUI 表示の影響:**

| シナリオ | 表示例 |
|---|---|
| **Normal team**（coordinator 正常、worker 1 blocked） | Attention: `[worker] blocked: Cannot connect to DB` |
| **Coordinator blocked** | Attention: `[coordinator] blocked: Cannot resolve worker dependencies` |
| **Coordinator-heavy team**（coordinator だけが動いている） | Attention: `[coordinator] blocked: ...` — これは異常であり、親が即座に介入すべき信号 |

**TUI での区別:**

TUI は `position` フィールドを見て色分け・ラベル分けできる：
- `position: "coordinator"` → 赤色背景 + "COORD" ラベル
- `position: "worker"` → 黄色背景 + "WORK" ラベル
- `position: "reviewer"` → 青色背景 + "REV" ラベル

** coordinator blocked が含まれるべき理由:**

1. **coordinator はチームの「心臓」**: coordinator が blocked したら、worker の完了を待つ人がいなくなる。これは worker の blocked より緊急
2. **TUI で視覚的に区別できる**: position ラベルで "COORD" と表示され、一目で異常を認識
3. **親の介入が最も早くなる**: coordinator blocked は「チーム全体が停止」の前兆。親が steer する最も重要なタイミング

**注意点:**

- coordinator の `completed`（正常終了）は依然として attention に含めない（フィルターで除外）
- coordinator の `failed` も含めるか？ → **含めるべき**。coordinator が failed したらチームは orphan になる

**実装の修正（3B の拡張）:**

```ts
// 修正後（coordinator の blocked/failed/help_requested を含める）
if (task.team_position === "coordinator") {
  // coordinator の terminal completed は attention ではない（正常終了）
  // しかし blocked / failed / help_requested はチーム停止の信号
  if (!["blocked", "failed", "help_requested"].includes(event.type)) return [];
}
```

**TUI テストでの確認項目:**

```ts
// team-attention.test.ts に追加
test("includes coordinator blocked in attention items", () => {
  const items = buildTeamAttentionItemsFromEvents([{
    task: { ...coordinatorTask, status: "blocked" },
    events: [{ type: "blocked", message: "Stalled", sequence: 1 }],
  }]);
  expect(items).toHaveLength(1);
  expect(items[0].position).toBe("coordinator");
  expect(items[0].type).toBe("blocked");
});

test("excludes coordinator completed from attention items", () => {
  const items = buildTeamAttentionItemsFromEvents([{
    task: { ...coordinatorTask, status: "completed" },
    events: [{ type: "completed", message: "Done", sequence: 1 }],
  }]);
  expect(items).toHaveLength(0);
});
```
