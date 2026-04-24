import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, it } from "bun:test";
import { runMigrations } from "../src/migrate.ts";
import { createSession } from "../src/session-store.ts";
import {
	completeTask,
	createTask,
	getTaskById,
	listTasksBySession,
	updateTaskNativeRef,
	updateTaskStatus,
	updateTaskSummary,
} from "../src/task-store.ts";

let db: Database;
beforeEach(() => {
	db = new Database(":memory:");
	db.exec("pragma foreign_keys = ON;");
	runMigrations(db);
	createSession(db, {
		id: "s1",
		project_root: "/p",
		worktree_path: "/w",
		parent_agent_kind: "pi",
	});
});

describe("createTask", () => {
	it("inserts a queued task by default", () => {
		const t = createTask(db, {
			id: "t1",
			session_id: "s1",
			target_agent_kind: "claude-code",
			objective: "Do a thing",
		});
		expect(t.status).toBe("queued");
		expect(t.completed_at).toBeNull();
		expect(t.model).toBeNull();
		expect(t.summary).toBeNull();
	});

	it("returns the row as it lives in the DB (re-read after insert)", () => {
		const inserted = createTask(db, {
			id: "t1",
			session_id: "s1",
			target_agent_kind: "pi",
			objective: "x",
		});
		const fetched = getTaskById(db, "t1");
		expect(fetched).toEqual(inserted);
	});

	it("persists model when provided", () => {
		const t = createTask(db, {
			id: "t1",
			session_id: "s1",
			target_agent_kind: "claude-code",
			model: "sonnet",
			objective: "x",
		});
		expect(t.model).toBe("sonnet");
	});

	it("persists parent_task_id for lineage", () => {
		createTask(db, { id: "t1", session_id: "s1", target_agent_kind: "pi", objective: "a" });
		const t2 = createTask(db, {
			id: "t2",
			session_id: "s1",
			target_agent_kind: "pi",
			objective: "b",
			parent_task_id: "t1",
		});
		expect(t2.parent_task_id).toBe("t1");
	});

	it("enforces the FK to sessions (unknown session_id throws)", () => {
		expect(() =>
			createTask(db, {
				id: "t1",
				session_id: "missing",
				target_agent_kind: "pi",
				objective: "x",
			}),
		).toThrow();
	});
});

describe("getTaskById", () => {
	it("returns null for unknown id", () => {
		expect(getTaskById(db, "nope")).toBeNull();
	});

	it("returns the stored task", () => {
		createTask(db, { id: "t1", session_id: "s1", target_agent_kind: "pi", objective: "x" });
		const t = getTaskById(db, "t1");
		expect(t?.id).toBe("t1");
	});
});

describe("listTasksBySession", () => {
	it("returns tasks for the session only", () => {
		createSession(db, {
			id: "s2",
			project_root: "/p",
			worktree_path: "/w",
			parent_agent_kind: "pi",
		});
		createTask(db, { id: "t1", session_id: "s1", target_agent_kind: "pi", objective: "a" });
		createTask(db, { id: "t2", session_id: "s2", target_agent_kind: "pi", objective: "b" });
		const list = listTasksBySession(db, "s1");
		expect(list).toHaveLength(1);
		expect(list[0]?.id).toBe("t1");
	});

	it("returns an empty array when no tasks match", () => {
		expect(listTasksBySession(db, "s1")).toEqual([]);
	});
});

describe("updateTaskStatus", () => {
	beforeEach(() => {
		createTask(db, { id: "t1", session_id: "s1", target_agent_kind: "pi", objective: "x" });
	});

	it("sets completed_at on terminal transitions", () => {
		const t = updateTaskStatus(db, "t1", "completed");
		expect(t?.status).toBe("completed");
		expect(t?.completed_at).not.toBeNull();
	});

	it("does not set completed_at for non-terminal status", () => {
		const t = updateTaskStatus(db, "t1", "running");
		expect(t?.completed_at).toBeNull();
	});

	it("preserves completed_at across repeated terminal updates", () => {
		const first = updateTaskStatus(db, "t1", "completed");
		const firstEnd = first?.completed_at;
		const second = updateTaskStatus(db, "t1", "failed");
		expect(second?.completed_at).toBe(firstEnd ?? "");
	});

	it("returns null for unknown id", () => {
		expect(updateTaskStatus(db, "nope", "running")).toBeNull();
	});
});

describe("updateTaskNativeRef", () => {
	beforeEach(() => {
		createTask(db, { id: "t1", session_id: "s1", target_agent_kind: "pi", objective: "x" });
	});

	it("sets the native_task_ref (e.g. tmux pane_id after adapter spawn)", () => {
		const t = updateTaskNativeRef(db, "t1", "%17");
		expect(t?.native_task_ref).toBe("%17");
	});

	it("bumps updated_at", async () => {
		const before = getTaskById(db, "t1");
		await Bun.sleep(5);
		const after = updateTaskNativeRef(db, "t1", "%17");
		expect(after?.updated_at).not.toBe(before?.updated_at);
	});

	it("can clear the ref by passing null", () => {
		updateTaskNativeRef(db, "t1", "%17");
		const t = updateTaskNativeRef(db, "t1", null);
		expect(t?.native_task_ref).toBeNull();
	});

	it("returns null for unknown id", () => {
		expect(updateTaskNativeRef(db, "nope", "x")).toBeNull();
	});
});

describe("updateTaskSummary", () => {
	beforeEach(() => {
		createTask(db, { id: "t1", session_id: "s1", target_agent_kind: "pi", objective: "x" });
	});

	it("sets the summary for progress reporting", () => {
		const t = updateTaskSummary(db, "t1", "Editing src/api/client.ts");
		expect(t?.summary).toBe("Editing src/api/client.ts");
	});

	it("does not touch status, result_ref, transcript_ref, or completed_at", () => {
		const t = updateTaskSummary(db, "t1", "wip");
		expect(t?.status).toBe("queued");
		expect(t?.result_ref).toBeNull();
		expect(t?.transcript_ref).toBeNull();
		expect(t?.completed_at).toBeNull();
	});

	it("returns null for unknown id", () => {
		expect(updateTaskSummary(db, "nope", "wip")).toBeNull();
	});
});

describe("completeTask", () => {
	beforeEach(() => {
		createTask(db, { id: "t1", session_id: "s1", target_agent_kind: "pi", objective: "x" });
	});

	it("sets status, summary, result_ref, transcript_ref", () => {
		const t = completeTask(db, {
			id: "t1",
			status: "completed",
			summary: "Done",
			result_ref: ".cuekit/tasks/t1/result.json",
			transcript_ref: ".cuekit/tasks/t1/transcript.md",
		});
		expect(t?.status).toBe("completed");
		expect(t?.summary).toBe("Done");
		expect(t?.result_ref).toBe(".cuekit/tasks/t1/result.json");
		expect(t?.transcript_ref).toBe(".cuekit/tasks/t1/transcript.md");
		expect(t?.completed_at).not.toBeNull();
	});

	it("allows nullable summary / refs (failed task with no output)", () => {
		const t = completeTask(db, { id: "t1", status: "failed" });
		expect(t?.status).toBe("failed");
		expect(t?.summary).toBeNull();
		expect(t?.result_ref).toBeNull();
		expect(t?.transcript_ref).toBeNull();
		expect(t?.completed_at).not.toBeNull();
	});

	it("throws on non-terminal status (caller defect)", () => {
		expect(() => completeTask(db, { id: "t1", status: "running" })).toThrow(/defect/);
	});
});
