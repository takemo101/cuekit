import type { Database } from "bun:sqlite";
import { type Task, TaskSchema } from "./task.ts";
import { type TaskTeamRow, TaskTeamRowSchema } from "./task-team.ts";

export interface CreateTaskTeamInput {
	id: string;
	session_id: string;
	title: string;
	objective?: string;
	metadata?: Record<string, unknown>;
}

export function createTaskTeam(db: Database, input: CreateTaskTeamInput): TaskTeamRow {
	const now = new Date().toISOString();
	db.prepare(
		`insert into task_teams (id, session_id, title, objective, metadata_json, created_at, updated_at)
		 values (?, ?, ?, ?, ?, ?, ?)`,
	).run(
		input.id,
		input.session_id,
		input.title,
		input.objective ?? null,
		input.metadata ? JSON.stringify(input.metadata) : null,
		now,
		now,
	);
	const row = getTaskTeamById(db, input.id);
	if (!row) {
		throw new Error(`defect: inserted task team '${input.id}' but row could not be read back`);
	}
	return row;
}

export function getTaskTeamById(db: Database, id: string): TaskTeamRow | null {
	const row = db.prepare("select * from task_teams where id = ?").get(id);
	if (!row) return null;
	return TaskTeamRowSchema.parse(row);
}

export function listTaskTeamsBySession(db: Database, session_id: string): TaskTeamRow[] {
	const rows = db
		.prepare("select * from task_teams where session_id = ? order by created_at asc")
		.all(session_id);
	return rows.map((row) => TaskTeamRowSchema.parse(row));
}

export function listTasksByTeam(db: Database, team_id: string): Task[] {
	const rows = db
		.prepare("select * from tasks where team_id = ? order by created_at asc")
		.all(team_id);
	return rows.map((row) => TaskSchema.parse(row));
}
