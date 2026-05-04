import type { Database } from "bun:sqlite";
import { decodeTaskListCursor } from "@cuekit/core";
import { type Task, TaskSchema } from "./task.ts";
import { type TaskTeamRow, TaskTeamRowSchema } from "./task-team.ts";

export interface CreateTaskTeamInput {
	id: string;
	session_id: string;
	title: string;
	objective?: string;
	metadata?: Record<string, unknown>;
}

export interface TaskTeamListFilter {
	session_id?: string;
	cwd?: string;
	limit?: number;
	cursor?: string;
}

export const DEFAULT_LIST_TASK_TEAMS_LIMIT = 100;

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

export function listTaskTeams(db: Database, filter: TaskTeamListFilter = {}): TaskTeamRow[] {
	const conditions: string[] = [];
	const bindings: Record<string, string | number> = {};
	if (filter.session_id) {
		conditions.push("tt.session_id = :session_id");
		bindings[":session_id"] = filter.session_id;
	}
	const joinCwd = filter.cwd !== undefined;
	if (joinCwd && filter.cwd !== undefined) {
		conditions.push("s.worktree_path = :cwd");
		bindings[":cwd"] = filter.cwd;
	}
	if (filter.cursor !== undefined) {
		const { updated_at, id } = decodeTaskListCursor(filter.cursor);
		conditions.push(
			"(tt.updated_at < :cursor_u or (tt.updated_at = :cursor_u and tt.id > :cursor_i))",
		);
		bindings[":cursor_u"] = updated_at;
		bindings[":cursor_i"] = id;
	}
	bindings[":limit"] = filter.limit ?? DEFAULT_LIST_TASK_TEAMS_LIMIT;
	const where = conditions.length > 0 ? `where ${conditions.join(" and ")}` : "";
	const join = joinCwd ? "join sessions s on s.id = tt.session_id" : "";
	const rows = db
		.prepare(
			`select tt.* from task_teams tt ${join} ${where} order by tt.updated_at desc, tt.id asc limit :limit`,
		)
		.all(bindings);
	return rows.map((row) => TaskTeamRowSchema.parse(row));
}

export function listTasksByTeam(db: Database, team_id: string): Task[] {
	const rows = db
		.prepare("select * from tasks where team_id = ? order by created_at asc")
		.all(team_id);
	return rows.map((row) => TaskSchema.parse(row));
}

export function deleteTaskTeam(db: Database, id: string): boolean {
	const result = db.prepare("delete from task_teams where id = ?").run(id);
	return result.changes > 0;
}
