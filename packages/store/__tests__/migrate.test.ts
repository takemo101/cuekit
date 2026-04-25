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
	});

	it("is idempotent — running twice does not duplicate recorded versions", () => {
		const db = new Database(":memory:");
		runMigrations(db);
		runMigrations(db);
		const versions = getAppliedMigrations(db);
		const occurrences = versions.filter((v) => v === "001-init.sql").length;
		expect(occurrences).toBe(1);
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
