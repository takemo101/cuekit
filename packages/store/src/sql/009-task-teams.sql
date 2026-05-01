create table if not exists task_teams (
  id text primary key,
  session_id text not null,
  title text not null,
  objective text,
  metadata_json text,
  created_at text not null,
  updated_at text not null,
  foreign key(session_id) references sessions(id) on delete cascade
);

create index if not exists idx_task_teams_session_id on task_teams(session_id);
create index if not exists idx_task_teams_updated_at on task_teams(updated_at);

alter table tasks add column team_id text references task_teams(id) on delete set null;
alter table tasks add column team_position text;
create index if not exists idx_tasks_team_id on tasks(team_id);

create trigger if not exists trg_tasks_team_session_insert
before insert on tasks
when new.team_id is not null
  and not exists (
    select 1 from task_teams
    where task_teams.id = new.team_id
      and task_teams.session_id = new.session_id
  )
begin
  select raise(abort, 'team_id must belong to task session');
end;

create trigger if not exists trg_tasks_team_session_update
before update of session_id, team_id on tasks
when new.team_id is not null
  and not exists (
    select 1 from task_teams
    where task_teams.id = new.team_id
      and task_teams.session_id = new.session_id
  )
begin
  select raise(abort, 'team_id must belong to task session');
end;

create trigger if not exists trg_task_teams_session_update
before update of session_id on task_teams
when exists (
  select 1 from tasks
  where tasks.team_id = old.id
    and tasks.session_id != new.session_id
)
begin
  select raise(abort, 'team session cannot move while tasks reference it');
end;
