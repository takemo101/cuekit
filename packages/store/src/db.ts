import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const DEFAULT_DB_PATH = join(homedir(), ".cuekit", "state.db");

export interface OpenDatabaseOptions {
	path?: string;
}

export function openDatabase(options: OpenDatabaseOptions = {}): Database {
	const path = options.path ?? DEFAULT_DB_PATH;
	if (path !== ":memory:") {
		mkdirSync(dirname(path), { recursive: true });
	}
	const db = new Database(path, { create: true });
	// WAL gives better concurrent read/write; foreign keys are off by default in SQLite.
	db.exec("pragma journal_mode = WAL;");
	db.exec("pragma foreign_keys = ON;");
	return db;
}
