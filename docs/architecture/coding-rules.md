# cuekit コーディングルール

> See [`../specs/README.md`](../specs/README.md) for the protocol, state, adapter, and MCP specifications these rules support.

## 命名規約

### 禁止サフィックス

以下は原則禁止:

- `Manager`
- `Util`
- `Facade`
- `Service`
- `Runtime`
- `Engine`

### 推奨サフィックス

| 責務 | 推奨 |
|---|---|
| 保持・格納 | `*Store`, `*Registry`, `*Index`, `*Table` |
| 方針・分岐 | `*Policy`, `*Selector`, `*Router` |
| 適合・変換 | `*Adapter`, `*Bridge`, `*Mapper` |
| 実行 | `*Executor`, `*Scheduler`, `*Evaluator` |
| 調停 | `*Coordinator`, `*Dispatcher`, `*Controller` |

### cuekit での例

| 悪い | 良い |
|---|---|
| `TaskManager` | `TaskStore` / `TaskLifecyclePolicy` |
| `AdapterService` | `PiAdapter` |
| `McpUtil` | `buildMcpToolResult.ts` |
| `StateEngine` | `state-transition.ts` |

## 1ファイル = 1公開型

- 1 public type / 1 public function / 1 main module にする
- ファイル名はケバブケース
- private helper は同居可
- unrelated public exports をまとめない

例:

- `task-spec.ts`
- `task-status.ts`
- `task-result.ts`
- `task-error.ts`

## Pure core を守る

`packages/core` では以下を禁止する。

- `bun:*`
- SQLite access
- MCP SDK access
- process spawning
- filesystem side effects
- network calls

core は pure TypeScript + schema + state transition のみ。

## イミュータブル優先

```ts
// ❌
function markRunning(task: TaskRow) {
  task.status = "running";
  return task;
}

// ✅
function markRunning(task: TaskRow): TaskRow {
  return { ...task, status: "running" };
}
```

例外:
- function-local mutable `Map`
- transaction block 内の局所的 mutation
- performance-sensitive row assembly

ただし外へ漏らさない。

## スキーマを source of truth にする

- MCP input/output は Zod schema を持つ
- persisted row の decode も schema 経由に寄せる
- adapter の normalized result も schema に寄せる

Type だけ定義して parse しないのは避ける。

## コメントは Why のみ

### 書くべきもの
- なぜこの state transition にしたか
- なぜ steering を optional にしたか
- なぜここで runtime capability を落としているか
- なぜこの field を denormalize しているか

### 書かないもの
- コードの日本語訳
- obvious な説明
- 変更履歴コメント

## 3回ルール

同じ意図の重複が 3 回出るまで抽象化しない。

特に以下は慎重にする。

- generic adapter base class
- abstract repository hierarchy
- universal transport abstraction

## JSON / DB / MCP では snake_case を優先

cuekit は protocol / MCP / persistence が中心なので、外部境界では snake_case を優先する。

例:
- `task_id`
- `task_id`
- `parent_session_ref`
- `result_ref`

内部 helper も、境界型に寄せるなら snake_case を許容する。

## 例外ではなく structured error を優先

recoverable error は return する。

```ts
return {
  ok: false,
  error: {
    code: "invalid_state",
    message: "collect requires terminal task state"
  }
};
```

throw は defect のみ。

## テーブルは増やしすぎない

v0 の persistence は最小に保つ。

- `sessions`
- `tasks`

以上を前提に設計し、追加テーブルは concrete need が出てから。

## 既存パターンから学ぶ

新しい実装を始める前に、同レイヤーの既存コードを 2-3 個読む。

- core なら core の type/schema/state transition
- store なら store の row mapping / query
- adapters なら adapter capability handling
- mcp なら tool definition / result shaping
