import type { Database } from "bun:sqlite";
import {
	decodeTaskListCursor,
	isTerminalTaskStatus,
	type TaskListFilter,
	type TaskStatus,
	validateTaskTransition,
} from "@cuekit/core";
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

// Low-level row delete. Returns true if a row was removed. Policy
// (e.g. "only delete terminal tasks") lives at the command layer —
// this function trusts the caller. Does not touch the artifact
// directory (`.cuekit/tasks/<id>/`); operators can remove that
// separately or keep it for audit.
export function deleteTask(db: Database, id: string): boolean {
	const result = db.prepare("delete from tasks where id = ?").run(id);
	return result.changes > 0;
}

// Per-session history in creation order (oldest first). This is
// intentionally asymmetric with `listTasks`, which pages newest-first
// by `updated_at`:
//   • The set here is bounded by session lifetime, so pagination
//     isn't load-bearing — sessions don't accumulate unbounded tasks
//     the way a cross-session DB does.
//   • Per-session views are commonly read as a chronological
//     transcript of what the session did; `created_at asc` matches
//     that reading. Cross-session views are read as "what's active
//     right now"; `updated_at desc` matches that.
// If the two eventually need to share a contract, harmonize here
// rather than at `listTasks` — that one carries the pagination tax.
export function listTasksBySession(db: Database, session_id: string): Task[] {
	const rows = db
		.prepare("select * from tasks where session_id = ? order by created_at asc")
		.all(session_id);
	return rows.map((r) => TaskSchema.parse(r));
}

// Default page size when a caller doesn't specify one. 100 is
// "roughly a screenful of summaries" — enough that small deployments
// never hit the cap, small enough that a forgotten-filter call over
// a year-old DB doesn't pull tens of thousands of rows.
export const DEFAULT_LIST_TASKS_LIMIT = 100;

// Cross-session listing with protocol-level TaskListFilter. `cwd` filters by
// `sessions.worktree_path` via a JOIN; all other filters are direct.
//
// Pagination is keyset-based on `(updated_at desc, id asc)` — stable under
// concurrent inserts (new rows can't shift an open cursor) and O(log N)
// with idx_tasks_updated_at_id. The opaque `filter.cursor` encodes the
// last row of the previous page.
//
// Named parameters (:status, :cursor_u, …) are used throughout so
// reordering WHERE fragments can't silently shift positional bindings —
// the "live mine" pattern flagged by Oracle P2-3.
export function listTasks(db: Database, filter: TaskListFilter = {}): Task[] {
	const conditions: string[] = [];
	const bindings: Record<string, string | number> = {};

	if (filter.status) {
		conditions.push("t.status = :status");
		bindings[":status"] = filter.status;
	}
	if (filter.agent_kind) {
		conditions.push("t.target_agent_kind = :agent_kind");
		bindings[":agent_kind"] = filter.agent_kind;
	}
	if (filter.session_id) {
		conditions.push("t.session_id = :session_id");
		bindings[":session_id"] = filter.session_id;
	}
	const joinCwd = filter.cwd !== undefined;
	if (joinCwd && filter.cwd !== undefined) {
		conditions.push("s.worktree_path = :cwd");
		bindings[":cwd"] = filter.cwd;
	}

	// Keyset predicate: rows that come after the cursor in the
	// (updated_at desc, id asc) ordering. A new row whose updated_at falls
	// between the cursor row and the current page simply shows up on a
	// future fetch — it cannot shift the walk.
	if (filter.cursor !== undefined) {
		const { updated_at, id } = decodeTaskListCursor(filter.cursor);
		conditions.push(
			"(t.updated_at < :cursor_u or (t.updated_at = :cursor_u and t.id > :cursor_i))",
		);
		bindings[":cursor_u"] = updated_at;
		bindings[":cursor_i"] = id;
	}

	const where = conditions.length > 0 ? `where ${conditions.join(" and ")}` : "";
	const join = joinCwd ? "join sessions s on s.id = t.session_id" : "";

	bindings[":limit"] = filter.limit ?? DEFAULT_LIST_TASKS_LIMIT;

	const rows = db
		.prepare(
			`select t.* from tasks t ${join} ${where} order by t.updated_at desc, t.id asc limit :limit`,
		)
		.all(bindings);
	return rows.map((r) => TaskSchema.parse(r));
}

// Updates only the status. Enforces the state machine via
// `validateTaskTransition` and throws on violation — a forbidden
// transition is a defect, not a user error, so it propagates loud
// rather than returning a silent `null`. Unknown id still returns
// `null` (no state to transition from).
//
// Side-effects keyed off the transition:
//   • queued → running: stamps `started_at = now` the first time
//     (preserved across later transitions, same pattern as
//     `completed_at`).
//   • any → terminal: stamps `completed_at = now`, preserving any
//     prior value via COALESCE.
export function updateTaskStatus(db: Database, id: string, status: TaskStatus): Task | null {
	const current = getTaskById(db, id);
	if (!current) return null;
	const check = validateTaskTransition(current.status, status);
	if (!check.ok) {
		throw new Error(`defect: ${check.error.message}`);
	}
	const now = new Date().toISOString();
	const startedNow = current.status === "queued" && status === "running";
	if (isTerminalTaskStatus(status)) {
		db.prepare(
			`update tasks
			set status = :status,
				updated_at = :now,
				started_at = coalesce(started_at, :started_at),
				completed_at = coalesce(completed_at, :now)
			where id = :id`,
		).run({
			":status": status,
			":now": now,
			":started_at": startedNow ? now : null,
			":id": id,
		});
	} else {
		db.prepare(
			`update tasks
			set status = :status,
				updated_at = :now,
				started_at = coalesce(started_at, :started_at)
			where id = :id`,
		).run({
			":status": status,
			":now": now,
			":started_at": startedNow ? now : null,
			":id": id,
		});
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
	const current = getTaskById(db, input.id);
	if (!current) return null;
	// Enforce the same state-machine contract as `updateTaskStatus`: a
	// terminal→terminal flip (e.g. completed→failed) is a defect, not a
	// caller error. Skipping this was how an already-completed task could
	// be silently rewritten to failed.
	const check = validateTaskTransition(current.status, input.status);
	if (!check.ok) {
		throw new Error(`defect: ${check.error.message}`);
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
