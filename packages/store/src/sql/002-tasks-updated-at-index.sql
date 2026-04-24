-- Keyset pagination over `listTasks` walks rows in (updated_at DESC, id ASC).
-- Without this composite index every paged read over the whole table
-- full-scans then sorts. Matching the index direction keeps the seek O(log N).
create index if not exists idx_tasks_updated_at_id on tasks(updated_at desc, id asc);
