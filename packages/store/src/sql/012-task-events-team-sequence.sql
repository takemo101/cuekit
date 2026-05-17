-- Add team_sequence to task_events for efficient team-level event tracking
-- This enables wait_team(since_team_sequence) to detect changes without
-- returning full task snapshots when nothing has changed.

alter table task_events add column team_sequence integer;

create index if not exists idx_task_events_team_sequence on task_events(task_id, team_sequence) where team_sequence is not null;
