create table if not exists team_events (
  sequence integer primary key autoincrement,
  id text not null unique,
  team_id text not null,
  task_id text,
  position text,
  event_type text not null check (event_type in ('finding', 'decision', 'blocker', 'review_result')),
  message text not null,
  payload_json text,
  created_at text not null,
  foreign key(team_id) references task_teams(id) on delete cascade,
  foreign key(task_id) references tasks(id) on delete set null
);

create index if not exists idx_team_events_team_id_sequence on team_events(team_id, sequence);
create index if not exists idx_team_events_created_at on team_events(created_at);
