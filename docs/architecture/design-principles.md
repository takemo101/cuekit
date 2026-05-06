# cuekit 設計原則

> Related protocol and state specs are indexed in [`../specs/README.md`](../specs/README.md).

## 1. Protocol First

cuekit の中心は prompt や tool wiring ではなく、**stable protocol** である。

- runtime 差分は adapter に閉じ込める
- MCP surface は protocol の利用面であって protocol 自体ではない
- orchestrator skill は protocol の consumer である

## 2. Delegation First

v0 の主役は以下の4操作である。

- submit
- status
- collect
- cancel

`steer` は optional capability として扱う。v0 の本質ではない。

## 3. Parent-Agent-First Autonomy

cuekit は AI を workflow で制御する engine ではない。親エージェントが自分の判断で子エージェントを使うための **child-agent delegation substrate** である。

- 何を委譲するか、いつ待つか、いつ介入するか、結果をどう解釈するかは親エージェントが決める
- cuekit は submit / status / wait / attach / steer / result / cleanup の安定した境界を提供する
- team は複数 child task の lightweight view であり、swarm OS ではない
- strategy は開発作業の frame / playbook であり、workflow control ではない

## 4. Tell, Don’t Ask

状態を外で読み出して分岐しまくるのではなく、責務のある層に処理を集約する。

```ts
// ❌ Ask
if (task.status === "completed") {
  return collectTask(task.id);
}

// ✅ Tell
return taskLifecycle.ensureCollectable(task);
```

あるいは pure function に閉じ込める。

```ts
const result = ensureCollectable(taskStatus);
```

## 5. Parse, Don’t Validate

MCP input, DB rows, adapter outputs は「ただチェックする」のではなく、
**parse して型付きの値へ変換する**。

```ts
const parsed = TaskSpecSchema.safeParse(input);
if (!parsed.success) return invalidInput(parsed.error);
```

後続の層では `parsed.data` を前提にする。

## 6. Runtime Opacity

adapter の外側から runtime の内部事情を見せない。

親は以下だけを知ればよい。

- task id
- normalized status
- normalized summary
- result refs

以下は adapter の内部に閉じ込める。

- process id
- PTY session details
- CLI flags
- vendor-specific task/session identifiers

## 7. Truthful Capability Exposure

runtime ができないことを隠さない。

- steering できないなら `supports_steering = false`
- progress を細かく取れないならそれを返す
- transcript が無いなら fabricate しない

統一感より **真実性** を優先する。

## 8. Minimal Persistent Model

v0 では state を正規化しすぎない。

- `sessions`
- `tasks`

の最小構成で始める。

`projects`, `worktrees`, `artifacts`, `claims` は concrete need が出るまで追加しない。`task_events` は最小 v0 には入れないが、child reporting を実装する場合の最初の追加テーブルとする。別の notification / subscription 用テーブルは concrete need が出るまで追加しない。

## 9. Local First

cuekit はまずローカル開発者環境で強いことを優先する。

- global SQLite index
- worktree-local outputs
- lightweight runtime bindings

分散 orchestration は v0 の中心ではない。

## 10. Less Is More

以下は v0 に入れない。

- workflow engine
- swarm operating model
- memory platform
- kanban board
- generalized remote federation

cuekit は substrate に徹する。

## 11. Boundary Clarity

### core
pure protocol / schema / state transition

### store
persistent state only

### adapters
runtime translation only

### mcp
tool surface only

境界をまたぐ convenience 実装は避ける。

## 12. Error Semantics over Exceptions

回復可能な問題は structured error として返す。

例:
- adapter not found
- invalid state
- submit failed
- status unavailable

throw は defect や infrastructure corruption など、異常停止が妥当な場合に限る。

## 13. Explicit Over Implicit

- session は explicit に開始・終了する
- task は explicit に session に属する
- result は explicit に ref を持つ
- optional capability は explicit に宣言する

推測で埋めない。

## 14. Future-Compatible, Not Future-Bloated

将来の拡張余地は残すが、最初からテーブルや抽象化を増やしすぎない。

良い例:
- `parent_task_id` を置く
- `metadata` を optional で持つ
- capability を返せるようにする

悪い例:
- 未使用の lineage table を先に作る
- workflow engine 前提の state machine を入れる
- remote tenancy を見越した複雑な auth model を先に入れる
