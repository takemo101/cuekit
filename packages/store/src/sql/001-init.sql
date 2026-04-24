create table if not exists sessions (
  id text primary key,
  project_root text not null,
  worktree_path text not null,
  parent_agent_kind text not null,
  parent_session_ref text,
  status text not null,
  created_at text not null,
  updated_at text not null,
  ended_at text
);

create table if not exists tasks (
  id text primary key,
  session_id text not null,
  parent_task_id text,
  target_agent_kind text not null,
  model text,
  objective text not null,
  status text not null,
  native_task_ref text,
  summary text,
  result_ref text,
  transcript_ref text,
  created_at text not null,
  updated_at text not null,
  completed_at text,
  foreign key(session_id) references sessions(id)
);

create index if not exists idx_sessions_project_root on sessions(project_root);
create index if not exists idx_sessions_worktree_path on sessions(worktree_path);
create index if not exists idx_sessions_status on sessions(status);

create index if not exists idx_tasks_session_id on tasks(session_id);
create index if not exists idx_tasks_parent_task_id on tasks(parent_task_id);
create index if not exists idx_tasks_status on tasks(status);
create index if not exists idx_tasks_target_agent_kind on tasks(target_agent_kind);
