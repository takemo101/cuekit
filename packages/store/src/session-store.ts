import type { Database } from "bun:sqlite";
import type { SessionStatus } from "@cuekit/core";
import { type Session, SessionSchema } from "./session.ts";

export interface CreateSessionInput {
	id: string;
	project_root: string;
	worktree_path: string;
	parent_agent_kind: string;
	parent_session_ref?: string;
	config_root?: string;
	project_id?: string;
	project_name?: string;
	project_uid?: string;
}

export function createSession(db: Database, input: CreateSessionInput): Session {
	const now = new Date().toISOString();
	db.prepare(
		`insert into sessions (
			id, project_root, worktree_path, parent_agent_kind, parent_session_ref,
			config_root, project_id, project_name, project_uid,
			status, created_at, updated_at, ended_at
		) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	).run(
		input.id,
		input.project_root,
		input.worktree_path,
		input.parent_agent_kind,
		input.parent_session_ref ?? null,
		input.config_root ?? null,
		input.project_id ?? null,
		input.project_name ?? null,
		input.project_uid ?? null,
		"active",
		now,
		now,
		null,
	);
	// Read the row back through the schema so the returned value reflects the
	// DB's actual state, not whatever we just constructed.
	const row = getSessionById(db, input.id);
	if (!row) {
		throw new Error(`defect: inserted session '${input.id}' but row could not be read back`);
	}
	return row;
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

// Deletes a session and all of its tasks in one transaction. Returns
// true if the session row was removed. Child tasks are deleted
// unconditionally to satisfy the FK — policy ("only if all tasks are
// terminal") lives at the command layer, which verifies before
// calling. Does not touch any on-disk artifact directories; operators
// can remove those separately.
export function deleteSession(db: Database, id: string): boolean {
	return db.transaction(() => {
		db.prepare("delete from tasks where session_id = ?").run(id);
		const result = db.prepare("delete from sessions where id = ?").run(id);
		return result.changes > 0;
	})();
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
