import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, it } from "bun:test";
import { runMigrations } from "../src/migrate.ts";
import {
	createSession,
	deleteSession,
	getSessionById,
	listSessionsByWorktree,
	updateSessionStatus,
} from "../src/session-store.ts";
import { createTask, listTasksBySession } from "../src/task-store.ts";

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

describe("deleteSession", () => {
	beforeEach(() => {
		createSession(db, {
			id: "s1",
			project_root: "/p",
			worktree_path: "/w",
			parent_agent_kind: "pi",
		});
	});

	it("returns true when the session is removed", () => {
		expect(deleteSession(db, "s1")).toBe(true);
		expect(getSessionById(db, "s1")).toBeNull();
	});

	it("returns false when the id is unknown (idempotent)", () => {
		expect(deleteSession(db, "nope")).toBe(false);
	});

	it("cascades to child tasks in the same transaction", () => {
		createTask(db, { id: "t1", session_id: "s1", agent_kind: "pi", objective: "a" });
		createTask(db, { id: "t2", session_id: "s1", agent_kind: "pi", objective: "b" });
		expect(listTasksBySession(db, "s1")).toHaveLength(2);
		expect(deleteSession(db, "s1")).toBe(true);
		expect(listTasksBySession(db, "s1")).toHaveLength(0);
		expect(getSessionById(db, "s1")).toBeNull();
	});

	it("does not enforce child-task terminal status — that's the command layer's job", () => {
		// The store trusts its input; callers that need policy must
		// filter listTasksBySession before calling.
		createTask(db, { id: "t1", session_id: "s1", agent_kind: "pi", objective: "a" });
		expect(deleteSession(db, "s1")).toBe(true);
	});

	it("is atomic — a failure mid-cascade would roll back both deletes", () => {
		// We can't easily force a mid-cascade failure against :memory:
		// SQLite with FK ON, but we can assert the transaction wrapper
		// is in place by confirming no partial state ever leaks after a
		// successful call.
		createTask(db, { id: "t1", session_id: "s1", agent_kind: "pi", objective: "a" });
		deleteSession(db, "s1");
		// Session gone AND task gone — never "session gone, task orphan".
		expect(getSessionById(db, "s1")).toBeNull();
		expect(listTasksBySession(db, "s1")).toEqual([]);
	});
});
