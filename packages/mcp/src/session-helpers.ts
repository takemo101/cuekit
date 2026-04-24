import type { Database } from "bun:sqlite";
import { createSession, listSessionsByWorktree } from "@cuekit/store";

export function generateSessionId(): string {
	return `s_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export interface ResolveSessionInput {
	session_id?: string;
	cwd?: string;
	parent_agent_kind?: string;
}

// Returns an existing or newly-created active session id for the caller's
// cwd. The MCP surface doesn't have an explicit "create session" command
// per v0; submit_task auto-creates one so first-time callers just work.
export function resolveSessionId(db: Database, input: ResolveSessionInput): string {
	if (input.session_id) return input.session_id;
	const cwd = input.cwd ?? process.cwd();
	const existing = listSessionsByWorktree(db, cwd).find((s) => s.status === "active");
	if (existing) return existing.id;
	const id = generateSessionId();
	createSession(db, {
		id,
		project_root: cwd,
		worktree_path: cwd,
		parent_agent_kind: input.parent_agent_kind ?? "cuekit-cli",
	});
	return id;
}
