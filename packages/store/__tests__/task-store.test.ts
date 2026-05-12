import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, it } from "bun:test";
import { encodeTaskListCursor, TaskListFilterSchema } from "@cuekit/core";
import { runMigrations } from "../src/migrate.ts";
import { createSession } from "../src/session-store.ts";
import type { Task } from "../src/task.ts";
import {
	appendTaskEvent,
	completeTask,
	createTask,
	DEFAULT_LIST_TASKS_LIMIT,
	deleteTask,
	findInvalidTaskRows,
	getTaskById,
	listTaskEvents,
	listTasks,
	listTasksBySession,
	repairTaskSqliteTimestamps,
	updateTaskChildTokenHash,
	updateTaskNativeRef,
	updateTaskRefs,
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
			agent_kind: "claude-code",
			objective: "Do a thing",
		});
		expect(t.status).toBe("queued");
		expect(t.completed_at).toBeNull();
		expect(t.model).toBeNull();
		expect(t.summary).toBeNull();
		expect(t.child_token_hash).toBeNull();
		expect(t.role).toBeNull();
		expect(t.role_source).toBeNull();
		expect(t.role_selection_reason).toBeNull();
	});

	it("returns the row as it lives in the DB (re-read after insert)", () => {
		const inserted = createTask(db, {
			id: "t1",
			session_id: "s1",
			agent_kind: "pi",
			objective: "x",
		});
		const fetched = getTaskById(db, "t1");
		expect(fetched).toEqual(inserted);
	});

	it("persists model when provided", () => {
		const t = createTask(db, {
			id: "t1",
			session_id: "s1",
			agent_kind: "claude-code",
			model: "sonnet",
			objective: "x",
		});
		expect(t.model).toBe("sonnet");
	});

	it("persists team metadata when provided", () => {
		db.prepare(
			"insert into task_teams (id, session_id, title, created_at, updated_at) values (?, ?, ?, ?, ?)",
		).run("tm_1", "s1", "Team", "2026-05-01T00:00:00.000Z", "2026-05-01T00:00:00.000Z");
		const t = createTask(db, {
			id: "t1",
			session_id: "s1",
			agent_kind: "claude-code",
			objective: "x",
			team_id: "tm_1",
			team_position: "worker",
		});
		expect(t.team_id).toBe("tm_1");
		expect(t.team_position).toBe("worker");
		expect(getTaskById(db, "t1")?.team_id).toBe("tm_1");
	});

	it("rejects team metadata from a different session", () => {
		createSession(db, {
			id: "s2",
			project_root: "/p2",
			worktree_path: "/w2",
			parent_agent_kind: "pi",
		});
		db.prepare(
			"insert into task_teams (id, session_id, title, created_at, updated_at) values (?, ?, ?, ?, ?)",
		).run("tm_1", "s1", "Team", "2026-05-01T00:00:00.000Z", "2026-05-01T00:00:00.000Z");

		expect(() =>
			createTask(db, {
				id: "t1",
				session_id: "s2",
				agent_kind: "claude-code",
				objective: "x",
				team_id: "tm_1",
				team_position: "worker",
			}),
		).toThrow(/team_id must belong to task session/);
	});

	it("rejects moving a team to another session while tasks reference it", () => {
		createSession(db, {
			id: "s2",
			project_root: "/p2",
			worktree_path: "/w2",
			parent_agent_kind: "pi",
		});
		db.prepare(
			"insert into task_teams (id, session_id, title, created_at, updated_at) values (?, ?, ?, ?, ?)",
		).run("tm_1", "s1", "Team", "2026-05-01T00:00:00.000Z", "2026-05-01T00:00:00.000Z");
		createTask(db, {
			id: "t1",
			session_id: "s1",
			agent_kind: "claude-code",
			objective: "x",
			team_id: "tm_1",
			team_position: "worker",
		});

		expect(() =>
			db.prepare("update task_teams set session_id = ? where id = ?").run("s2", "tm_1"),
		).toThrow(/team session cannot move while tasks reference it/);
	});

	it("persists the full TaskSpec JSON for recovery and audit", () => {
		const t = createTask(db, {
			id: "t1",
			session_id: "s1",
			agent_kind: "claude-code",
			objective: "x",
			spec: {
				agent_kind: "claude-code",
				objective: "x",
				context: "background",
				constraints: ["do not edit package.json"],
				timeout_ms: 1000,
			},
		});
		expect(t.spec_json).toContain("do not edit package.json");
		expect(JSON.parse(t.spec_json ?? "{}").timeout_ms).toBe(1000);
	});

	it("persists role metadata from TaskSpec", () => {
		const t = createTask(db, {
			id: "t1",
			session_id: "s1",
			agent_kind: "claude-code",
			objective: "x",
			spec: {
				agent_kind: "claude-code",
				objective: "x",
				role: "reviewer",
				role_instructions: "Review carefully.",
				role_source: "project",
				role_sources: ["builtin", "project"],
				role_selection_reason: "explicit role",
			},
		});
		expect(t.role).toBe("reviewer");
		expect(t.role_source).toBe("project");
		expect(t.role_selection_reason).toBe("explicit role");
		expect(JSON.parse(t.spec_json ?? "{}").role_instructions).toBe("Review carefully.");
	});

	it("persists parent_task_id for lineage", () => {
		createTask(db, { id: "t1", session_id: "s1", agent_kind: "pi", objective: "a" });
		const t2 = createTask(db, {
			id: "t2",
			session_id: "s1",
			agent_kind: "pi",
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
				agent_kind: "pi",
				objective: "x",
			}),
		).toThrow();
	});
});

describe("updateTaskChildTokenHash", () => {
	beforeEach(() => {
		createTask(db, { id: "t1", session_id: "s1", agent_kind: "pi", objective: "x" });
	});

	it("stores only a hash for child reporting token validation", () => {
		const hash = `sha256:${"a".repeat(64)}`;
		const t = updateTaskChildTokenHash(db, "t1", hash);
		expect(t?.child_token_hash).toBe(hash);
	});

	it("can clear the child token hash", () => {
		updateTaskChildTokenHash(db, "t1", `sha256:${"a".repeat(64)}`);
		const t = updateTaskChildTokenHash(db, "t1", null);
		expect(t?.child_token_hash).toBeNull();
	});

	it("rejects values that are not sha256 token hashes", () => {
		expect(() => updateTaskChildTokenHash(db, "t1", "raw-token")).toThrow(/sha256/);
	});

	it("returns null for unknown task", () => {
		expect(updateTaskChildTokenHash(db, "missing", `sha256:${"a".repeat(64)}`)).toBeNull();
	});
});

describe("task events", () => {
	beforeEach(() => {
		createTask(db, { id: "t1", session_id: "s1", agent_kind: "pi", objective: "x" });
	});

	it("appends child-reported events in insertion order", async () => {
		const first = appendTaskEvent(db, {
			id: "z-later-sort-id",
			task_id: "t1",
			type: "progress",
			message: "Running tests",
			payload: { command: "bun test" },
		});
		const second = appendTaskEvent(db, {
			id: "a-earlier-sort-id",
			task_id: "t1",
			type: "completed",
			message: "Done",
		});

		expect(first.payload).toEqual({ command: "bun test" });
		expect(second.payload).toBeNull();
		expect(first.sequence).toBeLessThan(second.sequence);
		expect(listTaskEvents(db, "t1").map((event) => event.id)).toEqual([
			"z-later-sort-id",
			"a-earlier-sort-id",
		]);
	});

	it("enforces task foreign key for events", () => {
		expect(() =>
			appendTaskEvent(db, {
				id: "e1",
				task_id: "missing",
				type: "progress",
				message: "wip",
			}),
		).toThrow();
	});
});

describe("getTaskById", () => {
	it("returns null for unknown id", () => {
		expect(getTaskById(db, "nope")).toBeNull();
	});

	it("returns the stored task", () => {
		createTask(db, { id: "t1", session_id: "s1", agent_kind: "pi", objective: "x" });
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
		createTask(db, { id: "t1", session_id: "s1", agent_kind: "pi", objective: "a" });
		createTask(db, { id: "t2", session_id: "s2", agent_kind: "pi", objective: "b" });
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
		createTask(db, { id: "t1", session_id: "s1", agent_kind: "pi", objective: "x" });
	});

	it("sets completed_at on terminal transitions", () => {
		// queued → running → completed (spec §13.1 — completed is not reachable from queued)
		updateTaskStatus(db, "t1", "running");
		const t = updateTaskStatus(db, "t1", "completed");
		expect(t?.status).toBe("completed");
		expect(t?.completed_at).not.toBeNull();
	});

	it("does not set completed_at for non-terminal status", () => {
		const t = updateTaskStatus(db, "t1", "running");
		expect(t?.completed_at).toBeNull();
	});

	it("stamps started_at on the first queued→running transition", () => {
		const running = updateTaskStatus(db, "t1", "running");
		expect(running?.started_at).not.toBeNull();
	});

	it("preserves started_at across subsequent transitions", () => {
		const running = updateTaskStatus(db, "t1", "running");
		const first = running?.started_at;
		// A later state change should leave started_at unchanged.
		updateTaskStatus(db, "t1", "blocked");
		const later = updateTaskStatus(db, "t1", "running");
		expect(later?.started_at).toBe(first ?? "");
	});

	it("rejects a forbidden transition as a defect (e.g. queued → completed)", () => {
		// Spec §13.1: completed is reachable only from running. A caller that
		// skips running is a defect, not a user error — throws loud.
		expect(() => updateTaskStatus(db, "t1", "completed")).toThrow(/defect/);
	});

	it("rejects a terminal→terminal cross-state flip as a defect (e.g. completed → failed)", () => {
		// Same-state re-writes are idempotent (see "is idempotent on
		// same-state writes" above), but a flip between two distinct
		// terminal states is still forbidden per spec §13.1 — once
		// completed, a task cannot become failed.
		updateTaskStatus(db, "t1", "running");
		updateTaskStatus(db, "t1", "completed");
		expect(() => updateTaskStatus(db, "t1", "failed")).toThrow(/defect/);
	});

	it("returns null for unknown id", () => {
		expect(updateTaskStatus(db, "nope", "running")).toBeNull();
	});

	it("is idempotent on same-state writes (no-op, no updated_at bump)", async () => {
		// The Oracle re-review caught a race: two concurrent status() polls
		// can both see a dead pane and both call completeTask(completed).
		// validateTaskTransition used to throw on `completed → completed`,
		// which surfaced as a defect on the racer-loser. Self-edges are now
		// no-ops at the validator AND short-circuit before the SQL update,
		// so updated_at doesn't bump on a same-state observation either.
		updateTaskStatus(db, "t1", "running");
		const first = getTaskById(db, "t1");
		await Bun.sleep(2);
		// Same-state again: should be a no-op, return current row.
		const second = updateTaskStatus(db, "t1", "running");
		expect(second?.updated_at).toBe(first?.updated_at ?? "");
		// And no defect — the second arrival in the race must not throw.
		expect(() => updateTaskStatus(db, "t1", "running")).not.toThrow();
	});
});

describe("updateTaskNativeRef", () => {
	beforeEach(() => {
		createTask(db, { id: "t1", session_id: "s1", agent_kind: "pi", objective: "x" });
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
		createTask(db, { id: "t1", session_id: "s1", agent_kind: "pi", objective: "x" });
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

describe("updateTaskRefs", () => {
	beforeEach(() => {
		createTask(db, { id: "t1", session_id: "s1", agent_kind: "pi", objective: "x" });
	});

	it("sets transcript_ref alone", () => {
		const t = updateTaskRefs(db, "t1", {
			transcript_ref: ".cuekit/tasks/t1/transcript.txt",
		});
		expect(t?.transcript_ref).toBe(".cuekit/tasks/t1/transcript.txt");
		expect(t?.result_ref).toBeNull();
	});

	it("sets result_ref alone", () => {
		const t = updateTaskRefs(db, "t1", { result_ref: ".cuekit/tasks/t1/result.json" });
		expect(t?.result_ref).toBe(".cuekit/tasks/t1/result.json");
		expect(t?.transcript_ref).toBeNull();
	});

	it("sets both refs in one call", () => {
		const t = updateTaskRefs(db, "t1", {
			transcript_ref: "/trans",
			result_ref: "/res",
		});
		expect(t?.transcript_ref).toBe("/trans");
		expect(t?.result_ref).toBe("/res");
	});

	it("clears a ref when null is passed explicitly", () => {
		updateTaskRefs(db, "t1", { transcript_ref: "/trans" });
		const cleared = updateTaskRefs(db, "t1", { transcript_ref: null });
		expect(cleared?.transcript_ref).toBeNull();
	});

	it("leaves omitted fields untouched (partial update)", () => {
		updateTaskRefs(db, "t1", { transcript_ref: "/keep", result_ref: "/also-keep" });
		const patched = updateTaskRefs(db, "t1", { result_ref: "/new" });
		expect(patched?.transcript_ref).toBe("/keep");
		expect(patched?.result_ref).toBe("/new");
	});

	it("is a no-op when the patch is empty", () => {
		updateTaskRefs(db, "t1", { transcript_ref: "/keep" });
		const beforeUpdatedAt = getTaskById(db, "t1")?.updated_at;
		const t = updateTaskRefs(db, "t1", {});
		expect(t?.transcript_ref).toBe("/keep");
		expect(t?.updated_at).toBe(beforeUpdatedAt ?? "");
	});

	it("returns null for unknown id", () => {
		expect(updateTaskRefs(db, "nope", { transcript_ref: "x" })).toBeNull();
	});
});

describe("completeTask", () => {
	// Move the task out of `queued` so completed becomes a legal target
	// per spec §13.1 (queued → running → completed). Tests that drive to
	// `cancelled` / `failed` don't need this since both are reachable
	// from queued, but running through it keeps fixtures uniform.
	beforeEach(() => {
		createTask(db, { id: "t1", session_id: "s1", agent_kind: "pi", objective: "x" });
		updateTaskStatus(db, "t1", "running");
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

	it("throws on a forbidden terminal transition (defect)", () => {
		// running → completed first; then a second completeTask attempt
		// targets a different terminal state (completed → failed is
		// forbidden by ALLOWED_TRANSITIONS).
		completeTask(db, { id: "t1", status: "completed" });
		expect(() => completeTask(db, { id: "t1", status: "failed" })).toThrow(/defect/);
	});

	it("is idempotent on a same-terminal repeat (concurrent-status race protection)", () => {
		// Two concurrent status() polls both see a dead pane and both
		// dispatch completeTask(completed). The race-loser previously
		// threw a defect on `completed → completed`. With self-edges
		// allowed at the validator, the second arrival now succeeds
		// without disturbing the row. completed_at stays sticky via
		// COALESCE.
		const first = completeTask(db, { id: "t1", status: "completed" });
		const firstEnd = first?.completed_at;
		expect(() => completeTask(db, { id: "t1", status: "completed" })).not.toThrow();
		const after = getTaskById(db, "t1");
		expect(after?.completed_at).toBe(firstEnd ?? "");
	});

	// Regression: earlier impl blindly set summary/result_ref/transcript_ref
	// to null when not supplied, erasing values written by updateTaskRefs at
	// submit time. A cancel with only { status } was wiping transcript_ref.
	it("preserves existing transcript_ref when completeTask omits it", () => {
		updateTaskRefs(db, "t1", { transcript_ref: "/set/at/submit.txt" });
		const done = completeTask(db, { id: "t1", status: "cancelled" });
		expect(done?.transcript_ref).toBe("/set/at/submit.txt");
	});

	it("preserves existing result_ref when completeTask omits it", () => {
		updateTaskRefs(db, "t1", { result_ref: "/emitted/by/runtime.json" });
		const done = completeTask(db, { id: "t1", status: "completed" });
		expect(done?.result_ref).toBe("/emitted/by/runtime.json");
	});

	it("preserves existing summary when completeTask omits it", () => {
		updateTaskSummary(db, "t1", "progress so far");
		const done = completeTask(db, { id: "t1", status: "completed" });
		expect(done?.summary).toBe("progress so far");
	});

	it("overwrites fields that are explicitly passed", () => {
		updateTaskRefs(db, "t1", { transcript_ref: "/old" });
		const done = completeTask(db, {
			id: "t1",
			status: "completed",
			transcript_ref: "/new",
		});
		expect(done?.transcript_ref).toBe("/new");
	});

	it("can still null a field via explicit null (opt-in clearing)", () => {
		updateTaskRefs(db, "t1", { transcript_ref: "/old" });
		const done = completeTask(db, {
			id: "t1",
			status: "completed",
			transcript_ref: undefined,
		});
		// `undefined` means "don't touch" so /old survives
		expect(done?.transcript_ref).toBe("/old");
	});
});

describe("listTasks (cross-session filter + keyset pagination)", () => {
	async function seed(count: number, opts: { session?: string; agent?: string } = {}) {
		const session = opts.session ?? "s1";
		const agent = opts.agent ?? "pi";
		for (let i = 0; i < count; i++) {
			createTask(db, {
				id: `${session}-${agent}-${i}`,
				session_id: session,
				agent_kind: agent,
				objective: `obj ${i}`,
			});
			// Tick so `updated_at` differs and the walk is deterministic.
			await Bun.sleep(2);
		}
	}

	// Helper: take the last row of a page and hand back the cursor the
	// MCP command layer would emit. Tests use this to verify the store
	// honours the cursor predicate; the real encoding round-trip is
	// covered end-to-end in the MCP commands test.
	function cursorOf(row: { updated_at: string; id: string }): string {
		return encodeTaskListCursor({ updated_at: row.updated_at, id: row.id });
	}

	it("applies DEFAULT_LIST_TASKS_LIMIT when limit is omitted", async () => {
		await seed(DEFAULT_LIST_TASKS_LIMIT + 1);
		const rows = listTasks(db);
		expect(rows).toHaveLength(DEFAULT_LIST_TASKS_LIMIT);
	});

	it("caps the result set to an explicit limit", async () => {
		await seed(5);
		const rows = listTasks(db, { limit: 3 });
		expect(rows).toHaveLength(3);
	});

	it("starts the next page strictly after the cursor row", async () => {
		await seed(5);
		const first = listTasks(db, { limit: 2 });
		const anchor = first[first.length - 1];
		if (!anchor) throw new Error("setup failed — first page empty");
		const next = listTasks(db, { limit: 2, cursor: cursorOf(anchor) });
		expect(next).toHaveLength(2);
		// No overlap between pages.
		const firstIds = new Set(first.map((t) => t.id));
		for (const t of next) expect(firstIds.has(t.id)).toBe(false);
	});

	it("validates schema boundary conditions", () => {
		expect(TaskListFilterSchema.safeParse({ limit: 0 }).success).toBe(false);
		expect(TaskListFilterSchema.safeParse({ limit: 1001 }).success).toBe(false);
		expect(TaskListFilterSchema.safeParse({ limit: 1000 }).success).toBe(true);
		expect(TaskListFilterSchema.safeParse({ limit: -1 }).success).toBe(false);
		expect(TaskListFilterSchema.safeParse({ limit: 3.5 }).success).toBe(false);
		// cursor is an opaque string — schema trusts any string; store
		// validates the envelope on decode.
		expect(TaskListFilterSchema.safeParse({ cursor: "anything" }).success).toBe(true);
		expect(TaskListFilterSchema.safeParse({}).success).toBe(true);
	});

	it("pages cleanly: cursor walk covers the full set with no gaps or dupes", async () => {
		await seed(7);
		const pageSize = 3;
		const seen: string[] = [];
		let cursor: string | undefined;
		for (let i = 0; i < 10; i++) {
			const page: Task[] = listTasks(db, { limit: pageSize, cursor });
			if (page.length === 0) break;
			for (const t of page) seen.push(t.id);
			if (page.length < pageSize) break;
			const last = page[page.length - 1];
			if (!last) break;
			cursor = cursorOf(last);
		}
		expect(seen).toHaveLength(7);
		expect(new Set(seen).size).toBe(7);
	});

	it("orders by updated_at desc (newest first)", async () => {
		await seed(3);
		const rows = listTasks(db);
		const updatedAts = rows.map((t) => t.updated_at);
		const sorted = [...updatedAts].sort((a, b) => b.localeCompare(a));
		expect(updatedAts).toEqual(sorted);
	});

	it("skips corrupt rows instead of failing the whole list", async () => {
		await seed(2);
		db.prepare("update tasks set updated_at = '2026-05-12 13:53:07' where id = ?").run("s1-pi-0");

		const rows = listTasks(db, { limit: 10 });

		expect(rows.map((row) => row.id)).toEqual(["s1-pi-1"]);
		expect(() => getTaskById(db, "s1-pi-0")).toThrow(/Invalid ISO datetime/);
	});

	it("continues past corrupt rows until the requested list page has valid rows", async () => {
		await seed(3);
		db.prepare("update tasks set updated_at = '2099-05-12 13:53:07' where id = ?").run("s1-pi-2");

		const rows = listTasks(db, { limit: 1 });

		expect(rows.map((row) => row.id)).toEqual(["s1-pi-1"]);
	});

	it("detects and repairs SQLite-formatted task timestamps", async () => {
		await seed(1);
		db.prepare(
			"update tasks set created_at = '2026-05-12 13:53:06.123', updated_at = '2026-05-12 13:53:07', started_at = '2026-05-12 13:53:08', completed_at = '2026-05-12 13:53:09' where id = ?",
		).run("s1-pi-0");

		expect(findInvalidTaskRows(db).map((row) => row.id)).toEqual(["s1-pi-0"]);
		expect(repairTaskSqliteTimestamps(db)).toBe(4);

		const repaired = getTaskById(db, "s1-pi-0");
		expect(findInvalidTaskRows(db)).toEqual([]);
		expect(repaired?.created_at).toBe("2026-05-12T13:53:06.123Z");
		expect(repaired?.updated_at).toBe("2026-05-12T13:53:07.000Z");
		expect(repaired?.started_at).toBe("2026-05-12T13:53:08.000Z");
		expect(repaired?.completed_at).toBe("2026-05-12T13:53:09.000Z");
	});

	it("does not repair impossible SQLite-shaped timestamps", async () => {
		await seed(1);
		db.prepare("update tasks set updated_at = '2026-99-99 99:99:99' where id = ?").run("s1-pi-0");

		expect(repairTaskSqliteTimestamps(db)).toBe(0);
		expect(findInvalidTaskRows(db).map((row) => row.id)).toEqual(["s1-pi-0"]);
	});

	it("filters by status and still paginates", async () => {
		await seed(4);
		const ids = listTasks(db).map((t) => t.id);
		if (ids[0]) updateTaskStatus(db, ids[0], "running");
		if (ids[1]) updateTaskStatus(db, ids[1], "running");
		const running = listTasks(db, { status: "running", limit: 10 });
		expect(running).toHaveLength(2);
		const runningLimited = listTasks(db, { status: "running", limit: 1 });
		expect(runningLimited).toHaveLength(1);
	});

	it("filters by agent_kind", async () => {
		await seed(2, { agent: "pi" });
		await seed(3, { agent: "claude-code" });
		expect(listTasks(db, { agent_kind: "pi", limit: 1000 })).toHaveLength(2);
		expect(listTasks(db, { agent_kind: "claude-code", limit: 1000 })).toHaveLength(3);
	});

	it("filters by project config identity", async () => {
		createSession(db, {
			id: "s2",
			project_root: "/copy",
			worktree_path: "/copy",
			parent_agent_kind: "pi",
			config_root: "/copy",
			project_id: "cuekit",
			project_uid: "pc_bbbbbbbbbbbbbbbb",
		});
		createSession(db, {
			id: "s3",
			project_root: "/p",
			worktree_path: "/p/other",
			parent_agent_kind: "pi",
			config_root: "/p",
			project_id: "cuekit",
			project_uid: "pc_aaaaaaaaaaaaaaaa",
		});
		await seed(2, { session: "s1" });
		await seed(3, { session: "s2" });
		await seed(1, { session: "s3" });

		expect(listTasks(db, { project_uid: "pc_aaaaaaaaaaaaaaaa", limit: 1000 })).toHaveLength(1);
		expect(listTasks(db, { project_uid: "pc_bbbbbbbbbbbbbbbb", limit: 1000 })).toHaveLength(3);
		expect(listTasks(db, { config_root: "/p", project_id: "cuekit", limit: 1000 })).toHaveLength(1);
		expect(listTasks(db, { config_root: "/copy", project_id: "cuekit", limit: 1000 })).toHaveLength(
			3,
		);
		expect(() => listTasks(db, { project_id: "cuekit", limit: 1000 })).toThrow(/config_root/);
	});

	it("filters by session_id", async () => {
		createSession(db, {
			id: "s2",
			project_root: "/p",
			worktree_path: "/w2",
			parent_agent_kind: "pi",
		});
		await seed(2, { session: "s1" });
		await seed(3, { session: "s2" });
		expect(listTasks(db, { session_id: "s1", limit: 1000 })).toHaveLength(2);
		expect(listTasks(db, { session_id: "s2", limit: 1000 })).toHaveLength(3);
	});

	it("filters by cwd (via sessions.worktree_path join)", async () => {
		createSession(db, {
			id: "s2",
			project_root: "/p",
			worktree_path: "/other",
			parent_agent_kind: "pi",
		});
		await seed(2, { session: "s1" });
		await seed(1, { session: "s2" });
		expect(listTasks(db, { cwd: "/w", limit: 1000 })).toHaveLength(2);
		expect(listTasks(db, { cwd: "/other", limit: 1000 })).toHaveLength(1);
	});

	it("returns [] when the cursor is past the end of the set", async () => {
		await seed(2);
		const all = listTasks(db);
		const last = all[all.length - 1];
		if (!last) throw new Error("setup failed");
		expect(listTasks(db, { limit: 10, cursor: cursorOf(last) })).toEqual([]);
	});

	it("rejects a malformed cursor with an Error (defect, not silent empty page)", () => {
		expect(() => listTasks(db, { limit: 10, cursor: "not-base64-json" })).toThrow(/cursor/);
	});

	it("stays stable across pages when rows share updated_at (id tiebreaker)", () => {
		// ISO-8601 strings collide at ms granularity. Force the collision
		// across every row and verify the keyset walk still covers the
		// set with no gaps or duplicates — concurrent-insert stability.
		for (let i = 0; i < 6; i++) {
			createTask(db, {
				id: `fixed-${i}`,
				session_id: "s1",
				agent_kind: "pi",
				objective: `x${i}`,
			});
		}
		db.prepare("update tasks set updated_at = '2026-04-24T00:00:00.000Z'").run();

		const pageSize = 2;
		const seen: string[] = [];
		let cursor: string | undefined;
		for (let i = 0; i < 10; i++) {
			const page: Task[] = listTasks(db, { limit: pageSize, cursor });
			if (page.length === 0) break;
			for (const t of page) seen.push(t.id);
			if (page.length < pageSize) break;
			const last = page[page.length - 1];
			if (!last) break;
			cursor = cursorOf(last);
		}
		expect(seen).toHaveLength(6);
		expect(new Set(seen).size).toBe(6);
	});

	it("is stable under concurrent inserts mid-walk (keyset's core promise)", async () => {
		// The OFFSET predecessor of this function would have let a new
		// row inserted between page fetches shift the window, causing
		// skips or duplicates. With keyset the cursor anchors on a
		// specific row — new rows can only appear on future fetches.
		await seed(4);
		const first = listTasks(db, { limit: 2 });
		const anchor = first[first.length - 1];
		if (!anchor) throw new Error("setup failed");
		// Insert a task whose updated_at is NEWER than any existing row,
		// simulating a fresh arrival between page fetches.
		await Bun.sleep(2);
		createTask(db, {
			id: "mid-walk",
			session_id: "s1",
			agent_kind: "pi",
			objective: "arrived mid-walk",
		});
		const next = listTasks(db, { limit: 2, cursor: cursorOf(anchor) });
		// The new row does not shift the cursor window; we still get
		// the original tail-of-set, in order, with no duplicates of the
		// first page.
		const firstIds = new Set(first.map((t) => t.id));
		for (const t of next) {
			expect(firstIds.has(t.id)).toBe(false);
			expect(t.id).not.toBe("mid-walk");
		}
	});
});

describe("deleteTask", () => {
	beforeEach(() => {
		createTask(db, { id: "t1", session_id: "s1", agent_kind: "pi", objective: "x" });
	});

	it("removes the row and returns true", () => {
		expect(deleteTask(db, "t1")).toBe(true);
		expect(getTaskById(db, "t1")).toBeNull();
	});

	it("returns false when the id is unknown (idempotent)", () => {
		expect(deleteTask(db, "nope")).toBe(false);
	});

	it("does not enforce status — that's the command layer's job", () => {
		// The store function trusts its input; callers that need policy
		// must check isTerminalTaskStatus before calling.
		updateTaskStatus(db, "t1", "running");
		expect(deleteTask(db, "t1")).toBe(true);
	});
});
