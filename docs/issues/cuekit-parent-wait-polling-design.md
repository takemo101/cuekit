# Design: parent-side wait/polling APIs for child tasks

## 背景

cuekit は `submit_task` で子エージェント task を起動し、子は `report_task_event` で `progress` / `completed` / `failed` / `blocked` などを SQLite `task_events` に記録できる。

現状の親側 API は `get_task_status` / `list_task_events` / `get_task_result` などの primitive であり、親が「子 task の完了を待つ」には呼び出し側で polling loop を実装する必要がある。

この設計では、MCP/CLI に親向けの blocking wait API を追加し、単一 task と複数 task の非同期実行を扱いやすくする。

## ゴール

- 親エージェントが MCP 経由で task 完了を待てる
- 複数 task を並列 submit し、`all` / `any` で待てる
- terminal task の result / events を必要に応じてまとめて取得できる
- 待機対象を現在の project/session scope に限定できる
- push/notification/ack の仕組みは増やさず、既存の SQLite state を polling する

## 非ゴール

- 任意タイミングの push 通知
- parent notification queue / ack 管理
- wait timeout 時の自動 cancel
- 他 project / 他 session の task を横断的に監視する汎用 dashboard API

## API 方針

中心 API は複数 task 対応の `wait_tasks` とする。

単一 task 用の `wait_task` は薄い wrapper として追加してもよいが、内部的には `wait_tasks({ task_ids: [task_id] })` に寄せる。

## MCP: `wait_tasks`

### Input

```ts
{
  task_ids: string[];

  // scope restriction
  session_id?: string;
  cwd?: string;

  // wait behavior
  mode?: "all" | "any";        // default: "all"
  timeout_ms?: number;          // default: 300000 など
  poll_interval_ms?: number;    // default: 2000 など
  stop_on_failed?: boolean;     // default: false

  // output enrichment
  include_results?: boolean;    // default: true for terminal tasks
  include_events?: boolean;     // default: false
  since_event_sequences?: Record<string, number>;
}
```

### Output

```ts
{
  mode: "all" | "any";
  done: boolean;
  timed_out: boolean;
  scope: {
    session_id?: string;
    cwd?: string;
  };
  tasks: Array<{
    task_id: string;
    status: TaskStatus;
    terminal: boolean;
    result?: NormalizedTaskResult;
    events?: TaskEvent[];
  }>;
}
```

## MCP: `wait_task`

Optional sugar API。

```ts
{
  task_id: string;
  session_id?: string;
  cwd?: string;
  timeout_ms?: number;
  poll_interval_ms?: number;
  include_result?: boolean;
  include_events?: boolean;
  since_event_sequence?: number;
}
```

内部的には `wait_tasks` を呼び、単一 task の形に整形して返す。

## Scope 制限

`wait_tasks` は、デフォルトで現在の project から発生した task だけを対象にする。

cuekit の state DB はグローバルなので、scope 制限がないと別 project の task_id を誤って待つ可能性がある。親エージェントの orchestration API としては「自分の project/session の子 task だけ扱う」方が安全。

### Scope 判定ルール

1. 全 `task_id` が存在すること
2. `session_id` が指定されている場合:
   - 全 task の `session_id` が指定値と一致すること
3. `cwd` が指定されている場合:
   - 各 task の session の `worktree_path` が正規化後の `cwd` と一致すること
4. `cwd` が未指定の場合:
   - CLI は `process.cwd()` を使う
   - MCP は command context / server cwd から推定する
5. `session_id` と `cwd` の両方が指定された場合:
   - 両方を満たすこと
6. scope 外 task が1つでも混じった場合:
   - fail fast で `permission_denied` または `invalid_input` を返す
   - 一部だけ待つ挙動にはしない

### 推奨デフォルト

- 親が `submit_task` の戻り値で `session_id` を持っているなら、`wait_tasks` にも `session_id` を渡す
- `session_id` がない場合は current cwd/worktree scope で制限する

## Wait semantics

### Terminal status

既存の terminal 判定を利用する。

- `completed`
- `failed`
- `blocked`
- `cancelled`
- `timed_out`

### `mode: "all"`

全 task が terminal になったら return。

`stop_on_failed: true` の場合は、いずれかが `failed` / `blocked` / `timed_out` になった時点で early return する。

### `mode: "any"`

いずれかの task が terminal になったら return。

残り task は cancel しない。親が戻り値を見て、必要なら別途 `cancel_task` を呼ぶ。

### timeout

`timeout_ms` を超えたら `timed_out: true` で latest snapshot を返す。

wait timeout は task timeout ではないため、task 自体を勝手に `cancelled` / `timed_out` にしない。

## Internal flow

```ts
const deadline = Date.now() + timeout_ms;

while (Date.now() < deadline) {
  const snapshots = [];

  for (const task_id of task_ids) {
    // Must reuse the same refresh path as get_task_status:
    // - pane liveness
    // - adapter timeout
    // - child-reported terminal status
    const status = await refreshAndGetTaskStatus(task_id);
    const events = include_events ? listTaskEvents(task_id, since_event_sequences?.[task_id]) : undefined;
    const result = include_results && isTerminal(status) ? normalizeTaskResult(task) : undefined;
    snapshots.push({ task_id, status, terminal, events, result });
  }

  if (mode === "all" && snapshots.every(t => t.terminal)) return done(snapshots);
  if (mode === "any" && snapshots.some(t => t.terminal)) return done(snapshots);
  if (stop_on_failed && snapshots.some(t => isFailureLike(t.status))) return done(snapshots);

  await sleep(poll_interval_ms);
}

return timeout(latestSnapshots);
```

## CLI

```bash
cuekit task wait --task_id t1
cuekit task wait --task_id t1 --task_id t2 --mode all
cuekit task wait --task_id t1 --task_id t2 --mode any --include-results
cuekit task wait --session_id s_abc --task_id t1 --task_id t2
cuekit task wait --cwd /path/to/project --task_id t1
```

CLI のデフォルト scope は `process.cwd()`。

## Error handling

- `task_not_found`: task_id が存在しない
- `permission_denied` または `invalid_input`: task が指定/推定 scope 外
- `invalid_input`: `task_ids` が空、重複、`timeout_ms` / `poll_interval_ms` が不正
- `adapter_not_found`: status refresh に必要な adapter がない場合

## Testing

- terminal task は即時 return
- running task は poll して terminal になったら return
- child `report_task_event(completed)` で wait が解除される
- `mode=all` は全 terminal まで待つ
- `mode=any` は最初の terminal で返る
- `stop_on_failed` は failure-like status で early return
- timeout は task を cancel しない
- scope 外 task は fail fast
- `session_id` scope と `cwd` scope の両方を検証する

## Notes

この設計は push 通知ではなく、親が使いやすい polling primitive を追加するもの。

既存 ADR の「child reporting は SQLite `task_events` に保存し、parent_notifications/push/ack は具体的必要が出るまで実装しない」という方針と整合する。
