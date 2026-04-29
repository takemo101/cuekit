drop index if exists idx_task_events_task_id_sequence;
drop index if exists idx_task_events_type;

create table task_events_new (
  sequence integer primary key autoincrement,
  id text not null unique,
  task_id text not null,
  type text not null,
  message text,
  payload_json text check (payload_json is null or json_valid(payload_json)),
  created_at text not null,
  foreign key(task_id) references tasks(id) on delete cascade
);

insert into task_events_new (sequence, id, task_id, type, message, payload_json, created_at)
select sequence, id, task_id, type, message, payload_json, created_at
from task_events;

drop table task_events;
alter table task_events_new rename to task_events;

create index if not exists idx_task_events_task_id_sequence on task_events(task_id, sequence);
create index if not exists idx_task_events_type on task_events(type);
