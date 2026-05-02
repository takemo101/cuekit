import type { Database } from "bun:sqlite";
import { statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { JobError } from "@cuekit/core";
import { loadProjectConfig } from "@cuekit/project-config";
import { createSession, listSessionsByWorktree } from "@cuekit/store";

// All sessions created by the cuekit control surface carry this parent kind.
// The CHILD agent being submitted (TaskSpec.agent_kind) is NOT the parent —
// 'parent_agent_kind' on the session row describes who is orchestrating,
// which is cuekit itself when submit_task triggered auto-creation.
const CONTROL_SURFACE_AGENT_KIND = "cuekit-cli";

export function generateSessionId(): string {
	return `s_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export interface ResolveSessionInput {
	session_id?: string;
	cwd?: string;
}

export type ResolveSessionResult =
	| { ok: true; session_id: string }
	| { ok: false; error: JobError };

function invalidInput(message: string): ResolveSessionResult {
	return { ok: false, error: { code: "invalid_input", message, retryable: false } };
}

// Returns an existing or newly-created active session id for the caller's
// cwd. v0's MCP surface doesn't have an explicit "create session" command;
// submit_task auto-creates one via this helper so first-time callers just
// work. Passing an explicit `session_id` trusts the caller — adapter.submit
// verifies row existence and stored identity is never mutated.
export function resolveSessionId(db: Database, input: ResolveSessionInput): ResolveSessionResult {
	if (input.session_id) return { ok: true, session_id: input.session_id };
	const rawCwd = input.cwd ?? process.cwd();
	const cwd = resolve(rawCwd);
	const existing = listSessionsByWorktree(db, cwd).find((s) => s.status === "active");
	if (existing) return { ok: true, session_id: existing.id };
	const legacy =
		rawCwd !== cwd
			? listSessionsByWorktree(db, rawCwd).find((s) => s.status === "active")
			: undefined;
	if (legacy) return { ok: true, session_id: legacy.id };

	const loaded = loadProjectConfig(cwd);
	if (!loaded.ok) return invalidInput(loaded.error);

	const id = generateSessionId();
	createSession(db, {
		id,
		project_root: loaded.discovery.projectRoot,
		worktree_path: cwd,
		parent_agent_kind: CONTROL_SURFACE_AGENT_KIND,
		config_root: loaded.identity.config_root,
		project_id: loaded.identity.project_id,
		project_name: loaded.identity.project_name,
		project_uid: loaded.identity.project_uid,
	});
	return { ok: true, session_id: id };
}

// Walks up from `start` looking for a `.git` entry (directory for normal
// repos, file for submodules/worktrees). Falls back to `start` if no git
// directory is found, so non-git projects still get a sensible value.
export function findProjectRoot(start: string): string {
	let dir = resolve(start);
	while (true) {
		try {
			statSync(join(dir, ".git"));
			return dir;
		} catch {
			// not here — keep climbing
		}
		const parent = dirname(dir);
		if (parent === dir) return resolve(start);
		dir = parent;
	}
}
