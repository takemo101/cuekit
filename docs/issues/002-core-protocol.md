# Issue 002: core protocol と schema を実装する

## 目的
cuekit v0 の pure protocol 層を実装する。

## スコープ
`packages/core` に以下を実装する。

- `TaskStatus`
- `SessionStatus`
- `TaskSpec`
- `TaskResult`
- `TaskSummary`
- `JobError`
- `TaskRefs`
- `AdapterCapabilities`
- lifecycle helpers
- Zod schemas
- public exports

## 完了条件
- `@cuekit/core` 単体で typecheck / test が通る
- protocol shapes が `docs/specs/2026-04-23-cuekit-protocol-spec.md` と一致する
- state-related types が `docs/specs/2026-04-23-cuekit-state-model.md` と矛盾しない

## 受け入れ条件
- recoverable error は structured error で表現されている
- `ensureCollectable()` のような helper がある
- invalid state は throw ではなく explicit error/result を返す
- Zod schema が public protocol shape をカバーしている
- TypeScript 型は可能な限り Zod schema から inference される
- `packages/core/__tests__/` に最小テストがある

## 依存
- Issue 001

## 実装メモ
- `core` は pure に保つ
- Bun/SQLite/MCP SDK への依存は禁止
- `incur` への依存も禁止
- snake_case を protocol 境界で優先する
