import type { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(import.meta.dir, "sql");

const MIGRATIONS = [
	"001-init.sql",
	"002-tasks-updated-at-index.sql",
	"003-tasks-started-at.sql",
	"004-tasks-rename-target-agent-kind.sql",
	"005-tasks-spec-json.sql",
	"006-child-reporting.sql",
] as const;

// Bootstrap table created outside the migration files so it can be relied on
// by the tracking logic itself. Idempotent via `if not exists`.
const BOOTSTRAP_SQL = `
create table if not exists schema_migrations (
	version text primary key,
	applied_at text not null
);
`;

export function runMigrations(db: Database): void {
	db.exec(BOOTSTRAP_SQL);
	db.transaction(() => {
		const checkApplied = db.prepare("select 1 from schema_migrations where version = ?");
		const recordApplied = db.prepare(
			"insert into schema_migrations (version, applied_at) values (?, ?)",
		);
		for (const file of MIGRATIONS) {
			if (checkApplied.get(file)) continue;
			const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
			db.exec(sql);
			recordApplied.run(file, new Date().toISOString());
		}
	})();
}

export function getAppliedMigrations(db: Database): string[] {
	// Returns empty array if bootstrap has not run yet — safer than throwing.
	const exists = db
		.prepare("select 1 from sqlite_master where type = 'table' and name = 'schema_migrations'")
		.get();
	if (!exists) return [];
	const rows = db.prepare("select version from schema_migrations order by version").all() as Array<{
		version: string;
	}>;
	return rows.map((r) => r.version);
}
