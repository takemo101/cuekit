-- AI Ergonomics Phase 1 (#568): relax team_events.event_type so coordinators
-- can persist semantic labels beyond the original closed enum
-- ('finding' | 'decision' | 'blocker' | 'review_result').
--
-- SQLite cannot drop a CHECK constraint in place, so we recreate the table
-- with the same columns minus the enum check and migrate rows over. The
-- Zod schema (@cuekit/store TeamEventTypeSchema) is the source of truth
-- for the recommended vocabulary; this migration just stops the DB from
-- rejecting strings the schema accepts.

drop index if exists idx_team_events_team_id_sequence;
drop index if exists idx_team_events_created_at;

create table team_events_new (
  sequence integer primary key autoincrement,
  id text not null unique,
  team_id text not null,
  task_id text,
  position text,
  event_type text not null,
  message text not null,
  payload_json text,
  created_at text not null,
  foreign key(team_id) references task_teams(id) on delete cascade,
  foreign key(task_id) references tasks(id) on delete set null
);

insert into team_events_new (
  sequence, id, team_id, task_id, position, event_type, message, payload_json, created_at
)
select
  sequence, id, team_id, task_id, position, event_type, message, payload_json, created_at
from team_events;

drop table team_events;
alter table team_events_new rename to team_events;

create index if not exists idx_team_events_team_id_sequence on team_events(team_id, sequence);
create index if not exists idx_team_events_created_at on team_events(created_at);
