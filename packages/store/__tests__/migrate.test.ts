import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { getAppliedMigrations, runMigrations } from "../src/migrate.ts";

describe("runMigrations", () => {
	it("creates sessions and tasks tables", () => {
		const db = new Database(":memory:");
		runMigrations(db);
		const rows = db
			.prepare("select name from sqlite_master where type = 'table' order by name")
			.all() as Array<{ name: string }>;
		const names = rows.map((r) => r.name);
		expect(names).toContain("sessions");
		expect(names).toContain("tasks");
	});

	it("creates the schema_migrations tracking table", () => {
		const db = new Database(":memory:");
		runMigrations(db);
		const row = db
			.prepare("select name from sqlite_master where type = 'table' and name = 'schema_migrations'")
			.get();
		expect(row).toBeDefined();
	});

	it("records each applied migration version", () => {
		const db = new Database(":memory:");
		runMigrations(db);
		const versions = getAppliedMigrations(db);
		expect(versions).toContain("001-init.sql");
		expect(versions).toContain("006-child-reporting.sql");
		expect(versions).toContain("007-task-events-delete-cascade.sql");
	});

	it("upgrades existing task_events foreign keys to cascade on task delete", () => {
		const db = new Database(":memory:");
		db.exec("pragma foreign_keys = ON;");
		db.exec(`
			create table schema_migrations (version text primary key, applied_at text not null);
			create table sessions (
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
			create table tasks (
				id text primary key,
				session_id text not null,
				parent_task_id text,
				agent_kind text not null,
				model text,
				objective text not null,
				status text not null,
				native_task_ref text,
				child_token_hash text,
				summary text,
				result_ref text,
				transcript_ref text,
				created_at text not null,
				updated_at text not null,
				started_at text,
				completed_at text,
				spec_json text,
				foreign key(session_id) references sessions(id) on delete cascade
			);
			create table task_events (
				sequence integer primary key autoincrement,
				id text not null unique,
				task_id text not null,
				type text not null,
				message text,
				payload_json text check (payload_json is null or json_valid(payload_json)),
				created_at text not null,
				foreign key(task_id) references tasks(id)
			);
			create index idx_task_events_task_id_sequence on task_events(task_id, sequence);
			create index idx_task_events_type on task_events(type);
			insert into schema_migrations (version, applied_at) values
				('001-init.sql', '2026-04-30T00:00:00.000Z'),
				('002-tasks-updated-at-index.sql', '2026-04-30T00:00:00.000Z'),
				('003-tasks-started-at.sql', '2026-04-30T00:00:00.000Z'),
				('004-tasks-rename-target-agent-kind.sql', '2026-04-30T00:00:00.000Z'),
				('005-tasks-spec-json.sql', '2026-04-30T00:00:00.000Z'),
				('006-child-reporting.sql', '2026-04-30T00:00:00.000Z');
			insert into sessions (id, project_root, worktree_path, parent_agent_kind, status, created_at, updated_at)
			values ('s1', '/p', '/w', 'cuekit-cli', 'active', '2026-04-30T00:00:00.000Z', '2026-04-30T00:00:00.000Z');
			insert into tasks (id, session_id, agent_kind, objective, status, created_at, updated_at)
			values ('t1', 's1', 'claude-code', 'x', 'completed', '2026-04-30T00:00:00.000Z', '2026-04-30T00:00:00.000Z');
			insert into task_events (id, task_id, type, message, created_at)
			values ('e1', 't1', 'completed', 'Done', '2026-04-30T00:00:00.000Z');
		`);

		runMigrations(db);
		const preserved = db
			.prepare("select sequence, id, task_id, type, message from task_events")
			.all() as Array<{
			sequence: number;
			id: string;
			task_id: string;
			type: string;
			message: string | null;
		}>;
		expect(preserved).toEqual([
			{ sequence: 1, id: "e1", task_id: "t1", type: "completed", message: "Done" },
		]);
		db.prepare("delete from tasks where id = ?").run("t1");

		const events = db.prepare("select * from task_events where task_id = ?").all("t1");
		expect(events).toEqual([]);
		expect(getAppliedMigrations(db)).toContain("007-task-events-delete-cascade.sql");
	});

	it("creates child reporting storage", () => {
		const db = new Database(":memory:");
		runMigrations(db);
		const taskEventsTable = db
			.prepare("select name from sqlite_master where type = 'table' and name = 'task_events'")
			.get();
		const childTokenColumn = db
			.prepare("select name from pragma_table_info('tasks') where name = 'child_token_hash'")
			.get();
		expect(taskEventsTable).toBeDefined();
		expect(childTokenColumn).toBeDefined();
	});

	it("creates expected indexes", () => {
		const db = new Database(":memory:");
		runMigrations(db);
		const rows = db
			.prepare("select name from sqlite_master where type = 'index' and sql is not null")
			.all() as Array<{ name: string }>;
		const names = rows.map((r) => r.name);
		expect(names).toContain("idx_sessions_project_root");
		expect(names).toContain("idx_sessions_worktree_path");
		expect(names).toContain("idx_sessions_status");
		expect(names).toContain("idx_tasks_session_id");
		expect(names).toContain("idx_tasks_parent_task_id");
		expect(names).toContain("idx_tasks_status");
		expect(names).toContain("idx_tasks_agent_kind");
		expect(names).toContain("idx_task_events_task_id_sequence");
		expect(names).toContain("idx_task_events_type");
	});

	it("is idempotent — running twice does not duplicate recorded versions", () => {
		const db = new Database(":memory:");
		runMigrations(db);
		runMigrations(db);
		const versions = getAppliedMigrations(db);
		const occurrences = versions.filter((v) => v === "001-init.sql").length;
		expect(occurrences).toBe(1);
		expect(versions.filter((v) => v === "006-child-reporting.sql")).toHaveLength(1);
		expect(versions.filter((v) => v === "007-task-events-delete-cascade.sql")).toHaveLength(1);
	});

	it("wraps migrations in a transaction (failure rolls back partial state)", () => {
		// Seed the DB with a conflicting `sessions` table whose shape is incompatible
		// with `001-init.sql`. If the migration file ran without transaction, the
		// subsequent valid statements might still commit. With transaction, the
		// whole thing rolls back and `schema_migrations` has no entry.
		const db = new Database(":memory:");
		db.exec("create table sessions (bogus text);");
		try {
			runMigrations(db);
		} catch {
			// expected — migration can't re-create sessions with different shape
		}
		// 001-init should not be recorded since the transaction rolled back
		const applied = getAppliedMigrations(db);
		expect(applied).not.toContain("001-init.sql");
	});
});

describe("getAppliedMigrations", () => {
	it("returns an empty array on a fresh DB (no bootstrap yet)", () => {
		const db = new Database(":memory:");
		expect(getAppliedMigrations(db)).toEqual([]);
	});
});
