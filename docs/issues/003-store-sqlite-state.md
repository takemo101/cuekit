# Issue 003: SQLite state store を実装する

## 目的
cuekit の最小 state model を永続化する。

## スコープ
`packages/store` に以下を実装する。

- SQLite bootstrap
- migration runner
- `sessions` table
- `tasks` table
- session store
- task store
- row decode / encode

## 完了条件
- `~/.cuekit/state.db` を作成できる
- `sessions` / `tasks` を保存・更新・取得できる
- `result_ref` / `transcript_ref` を保持できる
- store package の unit test が通る

## 受け入れ条件
- schema は `docs/specs/2026-04-23-cuekit-state-model.md` に一致する
- sessions の active/completed/cancelled/failed を扱える
- tasks の queued/running/completed/failed/cancelled/timed_out/blocked を扱える
- `listSessionsByWorktree` 相当の query がある
- `listTasksBySession` 相当の query がある

## 依存
- Issue 001
- Issue 002

## 実装メモ
- state index は global に置く
- 大きい payload は DB に入れず ref を持つ
- row を素通しせず core schema で decode する
