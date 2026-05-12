import type { Database } from "bun:sqlite";
import { decodeTaskListCursor } from "@cuekit/core";
import type { Task } from "./task.ts";
import { parseTaskRowsForList } from "./task-store.ts";
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
	project_root?: string;
	project_scope?: {
		project_uid?: string;
		project_root: string;
	};
	project_uid?: string;
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
	const joinSession =
		filter.cwd !== undefined ||
		filter.project_root !== undefined ||
		filter.project_scope !== undefined ||
		filter.project_uid !== undefined;
	const join = joinSession ? "join sessions s on s.id = tt.session_id" : "";
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
	return parseTaskRowsForList(rows);
}

export function getTaskTeamMetadata(db: Database, id: string): Record<string, unknown> | null {
	const team = getTaskTeamById(db, id);
	if (!team) return null;
	if (!team.metadata_json) return {};
	try {
		const parsed = JSON.parse(team.metadata_json);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

export function setTaskTeamMetadata(
	db: Database,
	id: string,
	metadata: Record<string, unknown>,
): TaskTeamRow | null {
	const now = new Date().toISOString();
	const result = db
		.prepare("update task_teams set metadata_json = ?, updated_at = ? where id = ?")
		.run(JSON.stringify(metadata), now, id);
	if (result.changes <= 0) return null;
	return getTaskTeamById(db, id);
}

export function getTaskTeamMultiplexerMetadata(
	db: Database,
	id: string,
	backendKind: string,
): unknown | undefined {
	const metadata = getTaskTeamMetadata(db, id);
	const multiplexer = metadata?.multiplexer;
	if (!multiplexer || typeof multiplexer !== "object" || Array.isArray(multiplexer))
		return undefined;
	return (multiplexer as Record<string, unknown>)[backendKind];
}

export function setTaskTeamMultiplexerMetadata(
	db: Database,
	id: string,
	backendKind: string,
	value: unknown,
): TaskTeamRow | null {
	const metadata = getTaskTeamMetadata(db, id);
	if (!metadata) return null;
	const existingMultiplexer = metadata.multiplexer;
	const multiplexer =
		existingMultiplexer &&
		typeof existingMultiplexer === "object" &&
		!Array.isArray(existingMultiplexer)
			? { ...(existingMultiplexer as Record<string, unknown>) }
			: {};
	multiplexer[backendKind] = value;
	return setTaskTeamMetadata(db, id, { ...metadata, multiplexer });
}

export function clearTaskTeamMultiplexerMetadata(
	db: Database,
	id: string,
	backendKind: string,
): TaskTeamRow | null {
	const metadata = getTaskTeamMetadata(db, id);
	if (!metadata) return null;
	const existingMultiplexer = metadata.multiplexer;
	if (
		!existingMultiplexer ||
		typeof existingMultiplexer !== "object" ||
		Array.isArray(existingMultiplexer)
	) {
		return getTaskTeamById(db, id);
	}
	const multiplexer = { ...(existingMultiplexer as Record<string, unknown>) };
	delete multiplexer[backendKind];
	const nextMetadata = { ...metadata };
	if (Object.keys(multiplexer).length === 0) {
		delete nextMetadata.multiplexer;
	} else {
		nextMetadata.multiplexer = multiplexer;
	}
	return setTaskTeamMetadata(db, id, nextMetadata);
}

export function deleteTaskTeam(db: Database, id: string): boolean {
	const result = db.prepare("delete from task_teams where id = ?").run(id);
	return result.changes > 0;
}
