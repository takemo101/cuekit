import type { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(import.meta.dir, "sql");

const MIGRATIONS = ["001-init.sql"] as const;

export function runMigrations(db: Database): void {
	for (const file of MIGRATIONS) {
		const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
		db.exec(sql);
	}
}
