-- Rename `tasks.target_agent_kind` → `tasks.agent_kind` so the DB column
-- name matches the protocol field. The pre-rename name was historical:
-- it tried to disambiguate from `sessions.parent_agent_kind`, but in
-- practice every store→protocol projection had to hand-rename, and the
-- duplication was a recurring foot-bullet (Oracle review P2-9).
--
-- SQLite ≥3.25 supports `ALTER TABLE ... RENAME COLUMN` natively. Bun's
-- bundled SQLite is well past that threshold. The corresponding index
-- (idx_tasks_target_agent_kind from 001-init.sql) is automatically
-- updated to point at the new column; we drop and recreate it under
-- the matching name for clarity.
alter table tasks rename column target_agent_kind to agent_kind;

drop index if exists idx_tasks_target_agent_kind;
create index if not exists idx_tasks_agent_kind on tasks(agent_kind);
