# cuekit アーキテクチャ概要

> Related design and protocol specs are indexed in [`../specs/README.md`](../specs/README.md).

## 採用: Clean Architecture ベースの Protocol/Adapter 構成

cuekit は **coding agent 向けの lightweight delegation substrate** であり、中心は UI ではなく以下です。

- task delegation protocol
- adapter contract
- persistent state model
- MCP control surface

そのため、mimicui と同様に **Clean Architecture 系の依存方向**を採用しつつ、cuekit 向けに以下の4パッケージへ分割する。

## パッケージ構成

| パッケージ | 役割 | 外部I/O | 主責務 |
|---|---|---|---|
| `@cuekit/core` | pure domain / protocol | なし | task/session model, status, result, error, schema, state transition |
| `@cuekit/store` | persistence adapter | SQLite / file refs | sessions/tasks 永続化、row mapping |
| `@cuekit/adapters` | runtime bindings | CLI / HTTP / MCP など | pi / Claude Code / OpenCode を cuekit protocol に適合 |
| `@cuekit/mcp` | MCP surface | MCP transport | cuekit tools を公開し、core/store/adapters を接続 |

補助的に将来 `@cuekit/cli` を足してもよいが、MVP の中心ではない。

## なぜこの構成か

1. cuekit の本質は **protocol と adapter** である
2. orchestration は cuekit 自体ではなく、**cuekit を使う上位 layer** の責務である
3. storage は独立責務であり、runtime adapter と分けたほうが進化しやすい
4. MCP は重要だが **core そのものではなく reference control surface** である

## レイヤー構成

```text
┌───────────────────────────────────────┐
│ MCP Surface (packages/mcp)           │
│ submit/status/collect/cancel/list    │
├───────────────────────────────────────┤
│ Adapters (packages/adapters)         │
│ Pi / Claude Code / OpenCode bindings │
├───────────────────────────────────────┤
│ Store (packages/store)               │
│ SQLite state + local output refs     │
├───────────────────────────────────────┤
│ Core (packages/core)                 │
│ Protocol, schemas, transitions       │
└───────────────────────────────────────┘
```

## 依存方向

```text
MCP → Adapters → Core
    → Store    → Core
```

より厳密には:

- `core` は誰にも依存しない
- `store` は `core` の型・schema に依存してよい
- `adapters` は `core` の protocol に依存してよい
- `mcp` は `core` / `store` / `adapters` を利用する

### 禁止

```text
❌ core が bun:sqlite や MCP SDK に依存する
❌ core が pi / Claude Code / OpenCode の runtime 差分を知る
❌ store が adapter を import する
❌ adapter が別 adapter に依存する
```

## v0 の責務分離

### Core
- `TaskSpec`, `TaskStatus`, `TaskResult`, `JobError` などの定義
- required / optional capability の整理
- state transition helpers
- Zod schema

### Store
- `sessions`, `tasks` の最小 state model
- `~/.cuekit/state.db` の管理
- `<worktree>/.cuekit/` への result/transcript refs 管理

### Adapters
- target runtime への submit
- status translation
- result normalization
- cancellation
- optional steering

### MCP
- `submit_task`
- `get_task_status`
- `get_task_result`
- `cancel_task`
- `list_tasks`
- `list_adapters`
- `steer_task` は optional / experimental 扱い

## cuekit の立ち位置

cuekit は以下ではない。

- full workflow engine
- kanban system
- swarm OS
- knowledge graph platform
- long-term memory system

cuekit は **task delegation と result normalization の基盤**であり、
hive-mcp のような上位 coordination system がその上に乗ることはあっても、cuekit 自体がそこまで抱え込まない。

## state model の配置

v0 では project/worktree/session/task を完全正規化しすぎない。

- global index: `~/.cuekit/state.db`
- local outputs: `<worktree>/.cuekit/`

最小テーブル:
- `sessions`
- `tasks`

これで project/worktree 単位の orchestration を支えつつ、過剰設計を避ける。

## 開発順序

```text
Core → Store → Adapters → MCP
```

理由:

1. protocol が先に固まらないと store も adapter も安定しない
2. store がないと session/task の運用が曖昧になる
3. adapters は core + store の上で現実 runtime を吸収する
4. MCP は最後に control surface として被せる

## まとめ

cuekit のアーキテクチャは、Clean Architecture の依存方向を維持しつつ、
**protocol / state / runtime binding / MCP surface** の4責務へ明確に分割する。

この分離により、cuekit は小さく始めつつ、将来:

- richer adapter capabilities
- optional steering
- event subscriptions
- A2A-like interoperability

へ拡張しやすい基盤になる。