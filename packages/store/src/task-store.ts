import type { Database } from "bun:sqlite";
import { isTerminalTaskStatus, type TaskListFilter, type TaskStatus } from "@cuekit/core";
import { type Task, TaskSchema } from "./task.ts";

export interface CreateTaskInput {
	id: string;
	session_id: string;
	parent_task_id?: string;
	target_agent_kind: string;
	model?: string;
	objective: string;
	status?: TaskStatus;
	native_task_ref?: string;
}

export function createTask(db: Database, input: CreateTaskInput): Task {
	const now = new Date().toISOString();
	db.prepare(
		`insert into tasks (
			id, session_id, parent_task_id, target_agent_kind, model, objective, status,
			native_task_ref, summary, result_ref, transcript_ref,
			created_at, updated_at, completed_at
		) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	).run(
		input.id,
		input.session_id,
		input.parent_task_id ?? null,
		input.target_agent_kind,
		input.model ?? null,
		input.objective,
		input.status ?? "queued",
		input.native_task_ref ?? null,
		null,
		null,
		null,
		now,
		now,
		null,
	);
	// Read the row back through the schema so the returned value reflects the
	// DB's actual state, not whatever we just constructed.
	const row = getTaskById(db, input.id);
	if (!row) {
		throw new Error(`defect: inserted task '${input.id}' but row could not be read back`);
	}
	return row;
}

export function getTaskById(db: Database, id: string): Task | null {
	const row = db.prepare("select * from tasks where id = ?").get(id);
	if (!row) return null;
	return TaskSchema.parse(row);
}

export function listTasksBySession(db: Database, session_id: string): Task[] {
	const rows = db
		.prepare("select * from tasks where session_id = ? order by created_at asc")
		.all(session_id);
	return rows.map((r) => TaskSchema.parse(r));
}

// Default page size when a caller doesn't specify one. 100 is "roughly a
// screenful of summaries" — enough that small deployments never hit the
// cap, small enough that a forgotten-filter call over a year-old DB
// doesn't pull tens of thousands of rows across the MCP boundary.
export const DEFAULT_LIST_TASKS_LIMIT = 100;

// Cross-session listing with protocol-level TaskListFilter. `cwd` filters by
// `sessions.worktree_path` via a JOIN; all other filters are direct. Newest
// first (updated_at desc). Results are paginated via filter.limit / offset —
// see `DEFAULT_LIST_TASKS_LIMIT` for the default cap.
export function listTasks(db: Database, filter: TaskListFilter = {}): Task[] {
	const conditions: string[] = [];
	const params: (string | number)[] = [];
	if (filter.status) {
		conditions.push("t.status = ?");
		params.push(filter.status);
	}
	if (filter.agent_kind) {
		conditions.push("t.target_agent_kind = ?");
		params.push(filter.agent_kind);
	}
	if (filter.session_id) {
		conditions.push("t.session_id = ?");
		params.push(filter.session_id);
	}
	const joinCwd = filter.cwd !== undefined;
	if (joinCwd && filter.cwd !== undefined) {
		conditions.push("s.worktree_path = ?");
		params.push(filter.cwd);
	}
	const where = conditions.length > 0 ? `where ${conditions.join(" and ")}` : "";
	const join = joinCwd ? "join sessions s on s.id = t.session_id" : "";

	// Pagination. No unbounded sentinel: omitting `limit` applies the
	// default; the MCP-boundary schema caps explicit limits at 1000.
	const limit = filter.limit ?? DEFAULT_LIST_TASKS_LIMIT;
	const offset = filter.offset ?? 0;

	params.push(limit);
	params.push(offset);

	// Secondary sort by id keeps pagination stable when two rows share the
	// same updated_at (ms-precision ISO strings collide under rapid inserts).
	// Without it, LIMIT/OFFSET could silently drop or duplicate rows across
	// pages — the exact bug pagination is meant to prevent.
	const rows = db
		.prepare(
			`select t.* from tasks t ${join} ${where} order by t.updated_at desc, t.id asc limit ? offset ?`,
		)
		.all(...params);
	return rows.map((r) => TaskSchema.parse(r));
}

// Updates only the status. Caller is responsible for validating transitions
// via `validateTaskTransition` from @cuekit/core before calling. When moving to
// a terminal status, `completed_at` is set (preserving any prior value).
export function updateTaskStatus(db: Database, id: string, status: TaskStatus): Task | null {
	const now = new Date().toISOString();
	if (isTerminalTaskStatus(status)) {
		db.prepare(
			`update tasks
			set status = ?, updated_at = ?, completed_at = coalesce(completed_at, ?)
			where id = ?`,
		).run(status, now, now, id);
	} else {
		db.prepare("update tasks set status = ? , updated_at = ? where id = ?").run(status, now, id);
	}
	return getTaskById(db, id);
}

// Sets `native_task_ref` (typically the tmux pane_id captured after adapter
// spawn). Pass null to clear.
export function updateTaskNativeRef(
	db: Database,
	id: string,
	native_task_ref: string | null,
): Task | null {
	const now = new Date().toISOString();
	db.prepare("update tasks set native_task_ref = ?, updated_at = ? where id = ?").run(
		native_task_ref,
		now,
		id,
	);
	return getTaskById(db, id);
}

// Sets `summary` for progress reporting during execution. Pass null to clear.
export function updateTaskSummary(db: Database, id: string, summary: string | null): Task | null {
	const now = new Date().toISOString();
	db.prepare("update tasks set summary = ?, updated_at = ? where id = ?").run(summary, now, id);
	return getTaskById(db, id);
}

export interface TaskRefsUpdate {
	transcript_ref?: string | null;
	result_ref?: string | null;
}

// Patches transcript_ref and/or result_ref. Omitted fields are left untouched;
// null clears. Used by adapters at submit-time (to record the transcript
// path) and at completion (to record a runtime-emitted result file).
export function updateTaskRefs(db: Database, id: string, patch: TaskRefsUpdate): Task | null {
	const setClauses: string[] = [];
	const params: (string | null)[] = [];
	if (patch.transcript_ref !== undefined) {
		setClauses.push("transcript_ref = ?");
		params.push(patch.transcript_ref);
	}
	if (patch.result_ref !== undefined) {
		setClauses.push("result_ref = ?");
		params.push(patch.result_ref);
	}
	if (setClauses.length === 0) return getTaskById(db, id);
	const now = new Date().toISOString();
	setClauses.push("updated_at = ?");
	params.push(now);
	params.push(id);
	db.prepare(`update tasks set ${setClauses.join(", ")} where id = ?`).run(...params);
	return getTaskById(db, id);
}

export interface CompleteTaskInput {
	id: string;
	status: TaskStatus;
	summary?: string;
	result_ref?: string;
	transcript_ref?: string;
}

export function completeTask(db: Database, input: CompleteTaskInput): Task | null {
	if (!isTerminalTaskStatus(input.status)) {
		// Defect: `completeTask` is only meaningful for terminal states.
		// Non-terminal status transitions should use `updateTaskStatus` instead.
		throw new Error(`defect: completeTask requires a terminal status, got '${input.status}'`);
	}
	const now = new Date().toISOString();
	// Only overwrite the optional fields the caller actually provided. Earlier
	// implementations blindly set summary/result_ref/transcript_ref to null
	// when they were omitted, which erased values set by updateTaskRefs /
	// updateTaskSummary earlier in the lifecycle.
	const setClauses: string[] = [
		"status = ?",
		"updated_at = ?",
		"completed_at = coalesce(completed_at, ?)",
	];
	const params: (string | null)[] = [input.status, now, now];
	if (input.summary !== undefined) {
		setClauses.push("summary = ?");
		params.push(input.summary);
	}
	if (input.result_ref !== undefined) {
		setClauses.push("result_ref = ?");
		params.push(input.result_ref);
	}
	if (input.transcript_ref !== undefined) {
		setClauses.push("transcript_ref = ?");
		params.push(input.transcript_ref);
	}
	params.push(input.id);
	db.prepare(`update tasks set ${setClauses.join(", ")} where id = ?`).run(...params);
	return getTaskById(db, input.id);
}
