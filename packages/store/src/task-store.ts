import type { Database } from "bun:sqlite";
import { isTerminalTaskStatus, type TaskStatus } from "@cuekit/core";
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
	const row = {
		id: input.id,
		session_id: input.session_id,
		parent_task_id: input.parent_task_id ?? null,
		target_agent_kind: input.target_agent_kind,
		model: input.model ?? null,
		objective: input.objective,
		status: input.status ?? ("queued" as TaskStatus),
		native_task_ref: input.native_task_ref ?? null,
		summary: null,
		result_ref: null,
		transcript_ref: null,
		created_at: now,
		updated_at: now,
		completed_at: null,
	};
	db.prepare(
		`insert into tasks (
			id, session_id, parent_task_id, target_agent_kind, model, objective, status,
			native_task_ref, summary, result_ref, transcript_ref,
			created_at, updated_at, completed_at
		) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	).run(
		row.id,
		row.session_id,
		row.parent_task_id,
		row.target_agent_kind,
		row.model,
		row.objective,
		row.status,
		row.native_task_ref,
		row.summary,
		row.result_ref,
		row.transcript_ref,
		row.created_at,
		row.updated_at,
		row.completed_at,
	);
	return TaskSchema.parse(row);
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

export interface CompleteTaskInput {
	id: string;
	status: TaskStatus;
	summary?: string;
	result_ref?: string;
	transcript_ref?: string;
}

export function completeTask(db: Database, input: CompleteTaskInput): Task | null {
	if (!isTerminalTaskStatus(input.status)) {
		// This is a defect: `completeTask` is only meaningful for terminal states.
		// Non-terminal status transitions should use `updateTaskStatus` instead.
		throw new Error(`defect: completeTask requires a terminal status, got '${input.status}'`);
	}
	const now = new Date().toISOString();
	db.prepare(
		`update tasks
		set status = ?, summary = ?, result_ref = ?, transcript_ref = ?,
			updated_at = ?, completed_at = coalesce(completed_at, ?)
		where id = ?`,
	).run(
		input.status,
		input.summary ?? null,
		input.result_ref ?? null,
		input.transcript_ref ?? null,
		now,
		now,
		input.id,
	);
	return getTaskById(db, input.id);
}
