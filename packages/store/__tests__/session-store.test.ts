import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, it } from "bun:test";
import { runMigrations } from "../src/migrate.ts";
import {
	createSession,
	getSessionById,
	listSessionsByWorktree,
	updateSessionStatus,
} from "../src/session-store.ts";

let db: Database;
beforeEach(() => {
	db = new Database(":memory:");
	db.exec("pragma foreign_keys = ON;");
	runMigrations(db);
});

describe("createSession", () => {
	it("inserts and returns a session in 'active' status", () => {
		const s = createSession(db, {
			id: "s1",
			project_root: "/proj",
			worktree_path: "/proj/wt",
			parent_agent_kind: "pi",
		});
		expect(s.id).toBe("s1");
		expect(s.status).toBe("active");
		expect(s.ended_at).toBeNull();
		expect(s.parent_session_ref).toBeNull();
	});

	it("persists parent_session_ref when provided", () => {
		const s = createSession(db, {
			id: "s2",
			project_root: "/proj",
			worktree_path: "/proj/wt",
			parent_agent_kind: "claude-code",
			parent_session_ref: "calm-reef",
		});
		expect(s.parent_session_ref).toBe("calm-reef");
	});
});

describe("getSessionById", () => {
	it("returns null for unknown id", () => {
		expect(getSessionById(db, "nope")).toBeNull();
	});

	it("returns the stored session", () => {
		createSession(db, {
			id: "s1",
			project_root: "/p",
			worktree_path: "/w",
			parent_agent_kind: "pi",
		});
		const s = getSessionById(db, "s1");
		expect(s?.id).toBe("s1");
	});
});

describe("listSessionsByWorktree", () => {
	it("filters by worktree_path", () => {
		createSession(db, {
			id: "s1",
			project_root: "/p",
			worktree_path: "/w1",
			parent_agent_kind: "pi",
		});
		createSession(db, {
			id: "s2",
			project_root: "/p",
			worktree_path: "/w2",
			parent_agent_kind: "pi",
		});
		createSession(db, {
			id: "s3",
			project_root: "/p",
			worktree_path: "/w1",
			parent_agent_kind: "pi",
		});
		const list = listSessionsByWorktree(db, "/w1");
		expect(list).toHaveLength(2);
		expect(list.map((s) => s.id).sort()).toEqual(["s1", "s3"]);
	});

	it("returns an empty array when no session matches", () => {
		expect(listSessionsByWorktree(db, "/nowhere")).toEqual([]);
	});
});

describe("updateSessionStatus", () => {
	it("sets ended_at when transitioning to completed/failed/cancelled", () => {
		createSession(db, {
			id: "s1",
			project_root: "/p",
			worktree_path: "/w",
			parent_agent_kind: "pi",
		});
		const updated = updateSessionStatus(db, "s1", "completed");
		expect(updated?.status).toBe("completed");
		expect(updated?.ended_at).not.toBeNull();
	});

	it("does not set ended_at for 'active' (no-op transition)", () => {
		createSession(db, {
			id: "s1",
			project_root: "/p",
			worktree_path: "/w",
			parent_agent_kind: "pi",
		});
		const updated = updateSessionStatus(db, "s1", "active");
		expect(updated?.ended_at).toBeNull();
	});

	it("preserves existing ended_at on subsequent terminal updates", () => {
		createSession(db, {
			id: "s1",
			project_root: "/p",
			worktree_path: "/w",
			parent_agent_kind: "pi",
		});
		const first = updateSessionStatus(db, "s1", "completed");
		const firstEnd = first?.ended_at;
		const second = updateSessionStatus(db, "s1", "failed");
		expect(second?.ended_at).toBe(firstEnd ?? "");
	});

	it("returns null for unknown id", () => {
		expect(updateSessionStatus(db, "nope", "completed")).toBeNull();
	});
});
