-- `TaskStatusView.started_at` was always in the protocol schema (it's the
-- one timestamp callers need for "how long has this been running?") but
-- there was no DB column to persist it and no write-path. Added now so
-- the schema stops lying to MCP clients. Nullable because queued tasks
-- haven't started yet; populated on the first queued→running transition
-- and preserved across subsequent status updates.
alter table tasks add column started_at text;
