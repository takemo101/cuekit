alter table tasks add column child_token_hash text;

create table if not exists task_events (
  sequence integer primary key autoincrement,
  id text not null unique,
  task_id text not null,
  type text not null,
  message text,
  payload_json text check (payload_json is null or json_valid(payload_json)),
  created_at text not null,
  foreign key(task_id) references tasks(id)
);

create index if not exists idx_task_events_task_id_sequence on task_events(task_id, sequence);
create index if not exists idx_task_events_type on task_events(type);
