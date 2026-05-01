# cuekit 実装引き継ぎ指示

あなたは `/Users/kawasakiisao/Desktop/ai/cuekit` の実装を担当します。  
このプロジェクトは **coding agent 向け delegation substrate** で、現在は **設計・仕様・issue 分解まで完了**、これから実装に入る段階です。

## 最重要方針
- **Bun + TypeScript**
- **4 package 構成**
  - `@cuekit/core`
  - `@cuekit/store`
  - `@cuekit/adapters`
  - `@cuekit/mcp`
- `@cuekit/mcp` は **MCP 専用 package ではなく、incur ベースの control surface package**
- **同じ command 定義から CLI と MCP を公開**
- **Zod を contract の正本**として扱う
- `core` / `store` / `adapters` は **incur 非依存**
- v0 は **delegation-first**
- **steer は optional**
- 過剰な orchestration platform 化は禁止

---

## まず読むべきファイル
必ず最初に以下を読んで、方針を理解してから実装してください。

### ルート
- `README.md`

### 設計/仕様
- `docs/specs/README.md`
- `docs/specs/2026-04-23-cuekit-design.md`
- `docs/specs/2026-04-23-cuekit-protocol-spec.md`
- `docs/specs/2026-04-23-cuekit-adapter-spec.md`
- `docs/specs/2026-04-23-cuekit-mcp-api-spec.md`
- `docs/specs/2026-04-23-cuekit-state-model.md`

### アーキテクチャ
- `docs/architecture/README.md`
- `docs/architecture/overview.md`
- `docs/architecture/coding-rules.md`
- `docs/architecture/design-principles.md`
- `docs/architecture/development-workflow.md`
- `docs/architecture/error-handling.md`

### 実装計画
- `docs/plans/2026-04-23-cuekit-implementation-plan.md`

---

## GitHub Issues
実装タスクは GitHub Issue に詳細化済みです。  
基本的に **Issue #1 から順に着手**してください。

- #1 scaffold cuekit Bun workspace and package shells
- #2 implement core protocol and Zod schemas
- #3 implement SQLite session/task state store
- #4 define adapter contract and build first adapter spike
- #5 build incur-based CLI/MCP control surface
- #6 validate end-to-end flow and align docs

Repo:
- `https://github.com/takemo101/cuekit`

---

## 実装ルール

### 1. 依存境界
- `core`
  - pure TS only
  - Zod schema / protocol / lifecycle
  - Bun / SQLite / incur / MCP SDK 禁止
- `store`
  - SQLite persistence
  - `core` の schema を使って row decode
- `adapters`
  - runtime binding
  - result normalization
  - runtime 境界も Zod で検証
  - `incur` 禁止
- `mcp`
  - `incur` を使う
  - shared command tree を source of truth にする
  - CLI と MCP を同じ command 定義から expose

### 2. Zod 方針
- public input/output shape は **Zod schema を canonical**
- 型は可能な限り **schema から inference**
- DB row や adapter native output を素通ししない
- invalid state / recoverable error は throw より **structured error**

### 3. MVP scope
必要なのは以下です。

- submit
- status
- collect/result
- cancel
- list
- list_adapters
- steer は optional

不要:
- planner
- workflow engine
- kanban
- swarm OS
- long-term memory
- DAG scheduler
- multi-tenant cloud control plane

---

## package ごとの期待

### `@cuekit/core`
実装対象:
- `TaskStatus`
- `SessionStatus`
- `TaskSpec`
- `TaskResult`
- `TaskSummary`
- `TaskRefs`
- `JobError`
- `AdapterCapabilities`
- lifecycle helpers
- Zod schemas
- schema-first exports

### `@cuekit/store`
実装対象:
- `~/.cuekit/state.db`
- `sessions`
- `tasks`
- migration
- session/task store APIs
- schema-validated row decoding

### `@cuekit/adapters`
実装対象:
- `AgentAdapter`
- registry
- result normalizer
- まず1本の working adapter spike
- 残りは truthful stub でもよい

### `@cuekit/mcp`
実装対象:
- `incur` command tree
- CLI
- MCP
- commands:
  - `submit_task`
  - `get_task_status`
  - `get_task_result`
  - `cancel_task`
  - `list_tasks`
  - `list_adapters`
  - `steer_task` optional

---

## 実装順序
厳守してください。

1. Issue #1: workspace scaffold
2. Issue #2: core
3. Issue #3: store
4. Issue #4: adapters
5. Issue #5: incur-based control surface
6. Issue #6: e2e validation and docs

---

## 進め方
- 小さく進める
- 各 issue ごとに commit
- docs と実装がズレたら、必要最小限で docs も更新
- scope を勝手に広げない
- 不明点があれば、設計 docs を優先
- 特に `docs/architecture/overview.md` と `docs/specs/2026-04-23-cuekit-mcp-api-spec.md` に従うこと

---

## 最初の作業指示
まずは以下を実施してください。

1. リポジトリを開く
2. 上記の docs を読む
3. Issue #1 の内容に沿って workspace scaffold を実装
4. 完了後、何を作ったかを簡潔に報告

---

## 補足
このプロジェクトでは、`packages/mcp` という名前ですが、実態は **incur ベースの CLI/MCP control surface package** です。  
したがって、**MCP 用だけの別実装を作らず、command definitions を単一の source of truth にしてください。**
