alter table sessions add column config_root text;
alter table sessions add column project_id text;
alter table sessions add column project_name text;
alter table sessions add column project_uid text;

create index if not exists idx_sessions_project_uid on sessions(project_uid);
create index if not exists idx_sessions_config_project on sessions(config_root, project_id);
