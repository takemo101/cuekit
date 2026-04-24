import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, it } from "bun:test";
import { TaskListFilterSchema } from "@cuekit/core";
import { runMigrations } from "../src/migrate.ts";
import { createSession } from "../src/session-store.ts";
import {
	completeTask,
	createTask,
	DEFAULT_LIST_TASKS_LIMIT,
	getTaskById,
	listTasks,
	listTasksBySession,
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

describe("updateTaskRefs", () => {
	beforeEach(() => {
		createTask(db, { id: "t1", session_id: "s1", target_agent_kind: "pi", objective: "x" });
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

describe("listTasks (cross-session filter + pagination)", () => {
	// Seed a second session + an assortment of tasks so filter / pagination
	// combinations have something meaningful to slice through.
	async function seed(count: number, opts: { session?: string; agent?: string } = {}) {
		const session = opts.session ?? "s1";
		const agent = opts.agent ?? "pi";
		for (let i = 0; i < count; i++) {
			createTask(db, {
				id: `${session}-${agent}-${i}`,
				session_id: session,
				target_agent_kind: agent,
				objective: `obj ${i}`,
			});
			// Tick so updated_at differs and the `order by updated_at desc`
			// produces a deterministic order (newest last-inserted).
			await Bun.sleep(2);
		}
	}

	it("applies DEFAULT_LIST_TASKS_LIMIT when limit is omitted", async () => {
		// Insert one more than the default so we can tell truncation happened.
		await seed(DEFAULT_LIST_TASKS_LIMIT + 1);
		const rows = listTasks(db);
		expect(rows).toHaveLength(DEFAULT_LIST_TASKS_LIMIT);
	});

	it("caps the result set to an explicit limit", async () => {
		await seed(5);
		const rows = listTasks(db, { limit: 3 });
		expect(rows).toHaveLength(3);
	});

	it("skips `offset` rows before returning", async () => {
		await seed(5);
		const firstPage = listTasks(db, { limit: 2 });
		const secondPage = listTasks(db, { limit: 2, offset: 2 });
		expect(firstPage.map((t) => t.id)).not.toEqual(secondPage.map((t) => t.id));
		expect(secondPage).toHaveLength(2);
	});

	it("caps an explicit limit at the schema max (1000) — no unbounded sentinel", () => {
		// Regression against an earlier draft of this PR that treated
		// `limit: 0` as "return every row." The schema now rejects both 0
		// and values >1000; callers that need more than 1000 rows must
		// page via offset.
		expect(TaskListFilterSchema.safeParse({ limit: 0 }).success).toBe(false);
		expect(TaskListFilterSchema.safeParse({ limit: 1001 }).success).toBe(false);
		expect(TaskListFilterSchema.safeParse({ limit: 1000 }).success).toBe(true);
		expect(TaskListFilterSchema.safeParse({ limit: -1 }).success).toBe(false);
		expect(TaskListFilterSchema.safeParse({ limit: 3.5 }).success).toBe(false);
		expect(TaskListFilterSchema.safeParse({ offset: -1 }).success).toBe(false);
	});

	it("pages cleanly: limit+offset walk covers the full set with no gaps or dupes", async () => {
		await seed(7);
		const pageSize = 3;
		const seen: string[] = [];
		for (let offset = 0; offset < 10; offset += pageSize) {
			const page = listTasks(db, { limit: pageSize, offset });
			if (page.length === 0) break;
			for (const t of page) seen.push(t.id);
		}
		expect(seen).toHaveLength(7);
		expect(new Set(seen).size).toBe(7); // no duplicates
	});

	it("orders by updated_at desc (newest first)", async () => {
		await seed(3);
		const rows = listTasks(db);
		const updatedAts = rows.map((t) => t.updated_at);
		const sorted = [...updatedAts].sort((a, b) => b.localeCompare(a));
		expect(updatedAts).toEqual(sorted);
	});

	it("filters by status and still paginates", async () => {
		await seed(4);
		const ids = listTasks(db).map((t) => t.id);
		// Mark the first two running, leave the rest queued.
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
		const pi = listTasks(db, { agent_kind: "pi", limit: 1000 });
		const cc = listTasks(db, { agent_kind: "claude-code", limit: 1000 });
		expect(pi).toHaveLength(2);
		expect(cc).toHaveLength(3);
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
		await seed(2, { session: "s1" }); // sessions.s1.worktree_path = "/w"
		await seed(1, { session: "s2" }); // sessions.s2.worktree_path = "/other"
		const here = listTasks(db, { cwd: "/w", limit: 1000 });
		const there = listTasks(db, { cwd: "/other", limit: 1000 });
		expect(here).toHaveLength(2);
		expect(there).toHaveLength(1);
	});

	it("returns [] when offset exceeds total rows", async () => {
		await seed(2);
		expect(listTasks(db, { offset: 10 })).toEqual([]);
	});

	it("stays stable across pages when rows share updated_at (id tiebreaker)", () => {
		// ISO-8601 strings collide at ms granularity, so rapid inserts can
		// produce rows with identical `updated_at`. Force that collision by
		// writing the same timestamp to every row, then verify pagination
		// still covers the set with no gaps or duplicates.
		for (let i = 0; i < 6; i++) {
			createTask(db, {
				id: `fixed-${i}`,
				session_id: "s1",
				target_agent_kind: "pi",
				objective: `x${i}`,
			});
		}
		db.prepare("update tasks set updated_at = '2026-04-24T00:00:00.000Z'").run();

		const pageSize = 2;
		const seen: string[] = [];
		for (let offset = 0; offset < 10; offset += pageSize) {
			const page = listTasks(db, { limit: pageSize, offset });
			if (page.length === 0) break;
			for (const t of page) seen.push(t.id);
		}
		expect(seen).toHaveLength(6);
		expect(new Set(seen).size).toBe(6);
	});
});
