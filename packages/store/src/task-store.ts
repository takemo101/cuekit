import type { Database } from "bun:sqlite";
import {
	decodeTaskListCursor,
	isTerminalTaskStatus,
	type TaskListFilter,
	type TaskSpec,
	type TaskStatus,
	validateTaskTransition,
} from "@cuekit/core";
import { type Task, type TaskEvent, TaskEventSchema, TaskSchema } from "./task.ts";

const CHILD_TOKEN_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;

export interface CreateTaskInput {
	id: string;
	session_id: string;
	parent_task_id?: string;
	agent_kind: string;
	model?: string;
	role?: string;
	role_source?: string;
	role_selection_reason?: string;
	team_id?: string;
	team_position?: string;
	objective: string;
	status?: TaskStatus;
	native_task_ref?: string;
	spec?: TaskSpec;
}

export function createTask(db: Database, input: CreateTaskInput): Task {
	const now = new Date().toISOString();
	db.prepare(
		`insert into tasks (
			id, session_id, parent_task_id, agent_kind, model, role, role_source,
			role_selection_reason, team_id, team_position, objective, status, native_task_ref,
			summary, result_ref, transcript_ref, created_at, updated_at, completed_at, spec_json
		) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	).run(
		input.id,
		input.session_id,
		input.parent_task_id ?? null,
		input.agent_kind,
		input.model ?? null,
		input.role ?? input.spec?.role ?? null,
		input.role_source ?? input.spec?.role_source ?? null,
		input.role_selection_reason ?? input.spec?.role_selection_reason ?? null,
		input.team_id ?? null,
		input.team_position ?? null,
		input.objective,
		input.status ?? "queued",
		input.native_task_ref ?? null,
		null,
		null,
		null,
		now,
		now,
		null,
		input.spec ? JSON.stringify(input.spec) : null,
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
	return parseTaskRowsForList(rows);
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
	if ((filter.config_root === undefined) !== (filter.project_id === undefined)) {
		throw new Error("defect: config_root and project_id filters must be provided together");
	}
	const conditions: string[] = [];
	const bindings: Record<string, string | number> = {};

	if (filter.status) {
		conditions.push("t.status = :status");
		bindings[":status"] = filter.status;
	}
	if (filter.agent_kind) {
		conditions.push("t.agent_kind = :agent_kind");
		bindings[":agent_kind"] = filter.agent_kind;
	}
	if (filter.session_id) {
		conditions.push("t.session_id = :session_id");
		bindings[":session_id"] = filter.session_id;
	}
	if (filter.team_id) {
		conditions.push("t.team_id = :team_id");
		bindings[":team_id"] = filter.team_id;
	}
	const joinSession =
		filter.cwd !== undefined ||
		filter.project_root !== undefined ||
		filter.project_scope !== undefined ||
		filter.project_uid !== undefined ||
		filter.config_root !== undefined ||
		filter.project_id !== undefined;
	if (filter.cwd !== undefined) {
		conditions.push("s.worktree_path = :cwd");
		bindings[":cwd"] = filter.cwd;
	}
	if (filter.project_root !== undefined) {
		conditions.push("s.project_root = :project_root");
		bindings[":project_root"] = filter.project_root;
	}
	if (filter.project_scope !== undefined) {
		if (filter.project_scope.project_uid !== undefined) {
			conditions.push(
				"(s.project_uid = :project_scope_uid or s.project_root = :project_scope_root)",
			);
			bindings[":project_scope_uid"] = filter.project_scope.project_uid;
		} else {
			conditions.push("s.project_root = :project_scope_root");
		}
		bindings[":project_scope_root"] = filter.project_scope.project_root;
	}
	if (filter.project_uid !== undefined) {
		conditions.push("s.project_uid = :project_uid");
		bindings[":project_uid"] = filter.project_uid;
	}
	if (filter.config_root !== undefined) {
		conditions.push("s.config_root = :config_root");
		bindings[":config_root"] = filter.config_root;
	}
	if (filter.project_id !== undefined) {
		conditions.push("s.project_id = :project_id");
		bindings[":project_id"] = filter.project_id;
	}

	let cursor: { updated_at: string; id: string } | undefined;
	// Keyset predicate: rows that come after the cursor in the
	// (updated_at desc, id asc) ordering. A new row whose updated_at falls
	// between the cursor row and the current page simply shows up on a
	// future fetch — it cannot shift the walk.
	if (filter.cursor !== undefined) {
		cursor = decodeTaskListCursor(filter.cursor);
	}

	const join = joinSession ? "join sessions s on s.id = t.session_id" : "";
	const limit = filter.limit ?? DEFAULT_LIST_TASKS_LIMIT;
	const validRows: Task[] = [];
	const batchLimit = Math.max(limit, 50);

	while (validRows.length < limit) {
		const pageConditions = [...conditions];
		const pageBindings: Record<string, string | number> = { ...bindings, ":limit": batchLimit };
		if (cursor !== undefined) {
			pageConditions.push(
				"(t.updated_at < :cursor_u or (t.updated_at = :cursor_u and t.id > :cursor_i))",
			);
			pageBindings[":cursor_u"] = cursor.updated_at;
			pageBindings[":cursor_i"] = cursor.id;
		}
		const where = pageConditions.length > 0 ? `where ${pageConditions.join(" and ")}` : "";
		const rows = db
			.prepare(
				`select t.* from tasks t ${join} ${where} order by t.updated_at desc, t.id asc limit :limit`,
			)
			.all(pageBindings);
		if (rows.length === 0) break;
		validRows.push(...parseTaskRowsForList(rows).slice(0, limit - validRows.length));
		const last = rows[rows.length - 1] as { updated_at?: unknown; id?: unknown } | undefined;
		if (
			rows.length < batchLimit ||
			typeof last?.updated_at !== "string" ||
			typeof last.id !== "string"
		) {
			break;
		}
		cursor = { updated_at: last.updated_at, id: last.id };
	}
	return validRows;
}

export function parseTaskRowsForList(rows: unknown[]): Task[] {
	const parsed: Task[] = [];
	for (const row of rows) {
		const result = TaskSchema.safeParse(row);
		if (!result.success) {
			// List-style reads power TUI/MCP overviews; one corrupted row should
			// not make every task invisible. Single-row reads remain strict via
			// getTaskById(), and doctor reports/repairs these rows explicitly.
			continue;
		}
		parsed.push(result.data);
	}
	return parsed;
}

export interface InvalidTaskRow {
	id: string;
	issues: string[];
}

export function findInvalidTaskRows(db: Database, limit = 50): InvalidTaskRow[] {
	const rows = db.prepare("select * from tasks order by updated_at desc, id asc").all();
	const invalid: InvalidTaskRow[] = [];
	for (const row of rows) {
		const result = TaskSchema.safeParse(row);
		if (result.success) continue;
		const raw = row as { id?: unknown };
		invalid.push({
			id: typeof raw.id === "string" && raw.id.length > 0 ? raw.id : "<unknown>",
			issues: result.error.issues.map((issue) =>
				issue.path.length > 0 ? `${issue.path.join(".")}: ${issue.message}` : issue.message,
			),
		});
		if (invalid.length >= limit) break;
	}
	return invalid;
}

const SQLITE_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/;

function normalizeSqliteTimestamp(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const match = value.match(SQLITE_TIMESTAMP_PATTERN);
	if (!match) return null;
	const [, yearRaw, monthRaw, dayRaw, hourRaw, minuteRaw, secondRaw, fractionRaw] = match;
	if (!yearRaw || !monthRaw || !dayRaw || !hourRaw || !minuteRaw || !secondRaw) return null;
	const year = Number(yearRaw);
	const month = Number(monthRaw);
	const day = Number(dayRaw);
	const hour = Number(hourRaw);
	const minute = Number(minuteRaw);
	const second = Number(secondRaw);
	const millisecond = Number((fractionRaw ?? "").slice(0, 3).padEnd(3, "0"));
	const timestamp = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
	if (!Number.isFinite(timestamp)) return null;
	const date = new Date(timestamp);
	if (
		date.getUTCFullYear() !== year ||
		date.getUTCMonth() !== month - 1 ||
		date.getUTCDate() !== day ||
		date.getUTCHours() !== hour ||
		date.getUTCMinutes() !== minute ||
		date.getUTCSeconds() !== second
	) {
		return null;
	}
	return date.toISOString();
}

export function repairTaskSqliteTimestamps(db: Database): number {
	const columns = ["created_at", "updated_at", "started_at", "completed_at"] as const;
	const rows = db
		.prepare("select id, created_at, updated_at, started_at, completed_at from tasks")
		.all();
	let repaired = 0;
	for (const row of rows) {
		const raw = row as Record<string, unknown> & { id?: unknown };
		if (typeof raw.id !== "string" || raw.id.length === 0) continue;
		const assignments: string[] = [];
		const params: string[] = [];
		for (const column of columns) {
			const normalized = normalizeSqliteTimestamp(raw[column]);
			if (!normalized) continue;
			assignments.push(`${column} = ?`);
			params.push(normalized);
		}
		if (assignments.length === 0) continue;
		params.push(raw.id);
		db.prepare(`update tasks set ${assignments.join(", ")} where id = ?`).run(...params);
		repaired += assignments.length;
	}
	return repaired;
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
	// Same-state write is a no-op — return the current row without
	// touching `updated_at`, so the row's "newest activity" ordering on
	// listTasks isn't perturbed by a concurrent status-poll race that
	// happens to re-confirm the existing status.
	if (current.status === status) return current;
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

export function updateTaskChildTokenHash(
	db: Database,
	id: string,
	child_token_hash: string | null,
): Task | null {
	if (child_token_hash !== null && !CHILD_TOKEN_HASH_PATTERN.test(child_token_hash)) {
		throw new Error("child_token_hash must be a sha256:<64 lowercase hex chars> digest");
	}
	const now = new Date().toISOString();
	db.prepare("update tasks set child_token_hash = ?, updated_at = ? where id = ?").run(
		child_token_hash,
		now,
		id,
	);
	return getTaskById(db, id);
}

export interface AppendTaskEventInput {
	id: string;
	task_id: string;
	type: string;
	message?: string | null;
	payload?: unknown;
}

function parseTaskEventRow(row: unknown): TaskEvent {
	const raw = row as {
		sequence: number;
		id: string;
		task_id: string;
		type: string;
		message: string | null;
		payload_json: string | null;
		created_at: string;
		team_sequence: number | null;
	};
	return TaskEventSchema.parse({
		sequence: raw.sequence,
		id: raw.id,
		task_id: raw.task_id,
		type: raw.type,
		message: raw.message,
		payload: raw.payload_json === null ? null : JSON.parse(raw.payload_json),
		created_at: raw.created_at,
		team_sequence: raw.team_sequence,
	});
}

function getNextTeamSequence(db: Database, task_id: string): number | null {
	const taskRow = db.prepare("select team_id from tasks where id = ?").get(task_id) as
		| { team_id: string | null }
		| undefined;
	if (!taskRow?.team_id) return null;
	const row = db
		.prepare(
			`select coalesce(max(te.team_sequence), 0) as max_seq
			from task_events te
			join tasks t on te.task_id = t.id
			where t.team_id = ?`,
		)
		.get(taskRow.team_id) as { max_seq: number };
	return row.max_seq + 1;
}

export function appendTaskEvent(db: Database, input: AppendTaskEventInput): TaskEvent {
	const now = new Date().toISOString();
	const teamSequence = getNextTeamSequence(db, input.task_id);
	db.prepare(
		`insert into task_events (id, task_id, type, message, payload_json, created_at, team_sequence)
		values (?, ?, ?, ?, ?, ?, ?)`,
	).run(
		input.id,
		input.task_id,
		input.type,
		input.message ?? null,
		input.payload === undefined ? null : JSON.stringify(input.payload),
		now,
		teamSequence ?? null,
	);
	const row = db.prepare("select * from task_events where id = ?").get(input.id);
	if (!row) {
		throw new Error(`defect: inserted task event '${input.id}' but row could not be read back`);
	}
	return parseTaskEventRow(row);
}

export function listTaskEvents(db: Database, task_id: string): TaskEvent[] {
	const rows = db
		.prepare("select * from task_events where task_id = ? order by sequence asc")
		.all(task_id);
	return rows.map((row) => parseTaskEventRow(row));
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
