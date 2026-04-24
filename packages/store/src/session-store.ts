import type { Database } from "bun:sqlite";
import type { SessionStatus } from "@cuekit/core";
import { type Session, SessionSchema } from "./session.ts";

export interface CreateSessionInput {
	id: string;
	project_root: string;
	worktree_path: string;
	parent_agent_kind: string;
	parent_session_ref?: string;
}

export function createSession(db: Database, input: CreateSessionInput): Session {
	const now = new Date().toISOString();
	const row = {
		id: input.id,
		project_root: input.project_root,
		worktree_path: input.worktree_path,
		parent_agent_kind: input.parent_agent_kind,
		parent_session_ref: input.parent_session_ref ?? null,
		status: "active" as const,
		created_at: now,
		updated_at: now,
		ended_at: null,
	};
	db.prepare(
		`insert into sessions (
			id, project_root, worktree_path, parent_agent_kind, parent_session_ref,
			status, created_at, updated_at, ended_at
		) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	).run(
		row.id,
		row.project_root,
		row.worktree_path,
		row.parent_agent_kind,
		row.parent_session_ref,
		row.status,
		row.created_at,
		row.updated_at,
		row.ended_at,
	);
	return SessionSchema.parse(row);
}

export function getSessionById(db: Database, id: string): Session | null {
	const row = db.prepare("select * from sessions where id = ?").get(id);
	if (!row) return null;
	return SessionSchema.parse(row);
}

export function listSessionsByWorktree(db: Database, worktree_path: string): Session[] {
	const rows = db
		.prepare("select * from sessions where worktree_path = ? order by created_at desc")
		.all(worktree_path);
	return rows.map((r) => SessionSchema.parse(r));
}

// Updates only the session status. The caller is responsible for validating the
// transition is legal before calling this — the store trusts its inputs. When
// transitioning to a terminal status, `ended_at` is set (preserving any prior
// value).
export function updateSessionStatus(
	db: Database,
	id: string,
	status: SessionStatus,
): Session | null {
	const now = new Date().toISOString();
	if (status === "active") {
		db.prepare("update sessions set status = ?, updated_at = ? where id = ?").run(status, now, id);
	} else {
		db.prepare(
			`update sessions
			set status = ?, updated_at = ?, ended_at = coalesce(ended_at, ?)
			where id = ?`,
		).run(status, now, now, id);
	}
	return getSessionById(db, id);
}
