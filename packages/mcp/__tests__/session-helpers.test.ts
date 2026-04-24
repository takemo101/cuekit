import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrations } from "@cuekit/store";
import { findProjectRoot, generateSessionId, resolveSessionId } from "../src/session-helpers.ts";

let db: Database;
beforeEach(() => {
	db = new Database(":memory:");
	db.exec("pragma foreign_keys = ON;");
	runMigrations(db);
});

describe("generateSessionId", () => {
	it("returns an 's_' prefixed id", () => {
		expect(generateSessionId()).toMatch(/^s_[a-f0-9]{12}$/);
	});

	it("returns a fresh id each call", () => {
		const a = generateSessionId();
		const b = generateSessionId();
		expect(a).not.toBe(b);
	});
});

describe("findProjectRoot", () => {
	it("walks up to the nearest .git directory", () => {
		const tmp = mkdtempSync(join(tmpdir(), "cuekit-helpers-"));
		try {
			mkdirSync(join(tmp, ".git"), { recursive: true });
			const nested = join(tmp, "packages", "foo");
			mkdirSync(nested, { recursive: true });
			expect(findProjectRoot(nested)).toBe(tmp);
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	it("detects a .git file (for submodules / worktrees)", () => {
		const tmp = mkdtempSync(join(tmpdir(), "cuekit-helpers-"));
		try {
			writeFileSync(join(tmp, ".git"), "gitdir: /elsewhere");
			const nested = join(tmp, "src");
			mkdirSync(nested, { recursive: true });
			expect(findProjectRoot(nested)).toBe(tmp);
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	it("falls back to the input when no .git is found", () => {
		const tmp = mkdtempSync(join(tmpdir(), "cuekit-helpers-"));
		try {
			// tmpdir parents generally have no .git all the way up
			expect(findProjectRoot(tmp)).toBe(tmp);
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});
});

describe("resolveSessionId", () => {
	it("returns the existing session_id when provided (trusts caller)", () => {
		expect(resolveSessionId(db, { session_id: "s_provided" })).toBe("s_provided");
	});

	it("creates a new session with parent_agent_kind 'cuekit-cli'", () => {
		const tmp = mkdtempSync(join(tmpdir(), "cuekit-helpers-"));
		try {
			const id = resolveSessionId(db, { cwd: tmp });
			const row = db.prepare("select * from sessions where id = ?").get(id) as
				| { parent_agent_kind: string; worktree_path: string }
				| undefined;
			expect(row?.parent_agent_kind).toBe("cuekit-cli");
			expect(row?.worktree_path).toBe(tmp);
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});
});
