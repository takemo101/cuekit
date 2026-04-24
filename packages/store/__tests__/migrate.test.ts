import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { runMigrations } from "../src/migrate.ts";

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
		expect(names).toContain("idx_tasks_target_agent_kind");
	});

	it("is idempotent — running twice does not throw or duplicate", () => {
		const db = new Database(":memory:");
		runMigrations(db);
		runMigrations(db);
		const tables = db
			.prepare("select count(*) as n from sqlite_master where type = 'table'")
			.get() as { n: number };
		expect(tables.n).toBeGreaterThanOrEqual(2);
	});
});
