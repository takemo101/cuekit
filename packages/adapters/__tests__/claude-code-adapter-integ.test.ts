import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession, getTaskById, runMigrations } from "@cuekit/store";
import { createClaudeCodeAdapter } from "../src/claude-code-adapter.ts";
import { PaneBackend } from "../src/pane-backend.ts";

// Real tmux integration for the ClaudeCode adapter: exercises the whole
// pipeline (adapter → PaneBackend → actual tmux binary → pane on disk) but
// substitutes a cheap `bash -c 'sleep 30'` for the claude invocation so we
// don't spawn the real claude CLI here. A separate opt-in smoke test against
// the real `claude` binary lives under docs/ as a manual verification step.
//
// Skipped when tmux is not installed (CI without it stays green).

function hasTmux(): boolean {
	try {
		const proc = Bun.spawnSync(["tmux", "-V"], { stdout: "pipe", stderr: "pipe" });
		return proc.exitCode === 0;
	} catch {
		return false;
	}
}

const suite = hasTmux() ? describe : describe.skip;

let db: Database;
let panes: PaneBackend;
let tmpRoot: string;
let adapter: ReturnType<typeof createClaudeCodeAdapter>;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "cuekit-claude-integ-"));
	db = new Database(":memory:");
	db.exec("pragma foreign_keys = ON;");
	runMigrations(db);
	createSession(db, {
		id: "s1",
		project_root: tmpRoot,
		worktree_path: tmpRoot,
		parent_agent_kind: "claude-code",
	});
	panes = new PaneBackend({ sendKeysDelayMs: 0 });
	adapter = createClaudeCodeAdapter(db, panes, {
		launchCommandOverride: () => "bash -c 'sleep 30'",
	});
});

afterEach(async () => {
	// Defensive cleanup: kill any lingering tmux sessions from this run so
	// parallel test invocations don't leak state.
	const rows = db
		.prepare("select id from tasks where target_agent_kind = 'claude-code'")
		.all() as Array<{ id: string }>;
	for (const row of rows) {
		try {
			await panes.killTask(row.id);
		} catch {
			// ignore — may already be gone
		}
	}
	rmSync(tmpRoot, { recursive: true, force: true });
});

suite("ClaudeCodeAdapter (real tmux integration)", () => {
	it("spawns a real pane, records native_task_ref, and tmux sees the session", async () => {
		const result = await adapter.submit({
			spec: {
				agent_kind: "claude-code",
				objective: "integration-test noop",
				model: "sonnet",
			},
			session_id: "s1",
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const task_id = result.value.task_id;

		// Row was updated by the adapter post-spawn
		const row = getTaskById(db, task_id);
		expect(row?.status).toBe("running");
		expect(row?.native_task_ref).toMatch(/^%\d+$/);

		// tmux actually sees the session
		expect(await panes.isAlive(task_id)).toBe(true);

		// Transcript dir was created on disk
		expect(existsSync(join(tmpRoot, ".cuekit", "tasks", task_id))).toBe(true);

		// Cancel and verify tmux has torn it down
		const ack = await adapter.cancel(task_id);
		expect(ack.ok).toBe(true);
		expect(await panes.isAlive(task_id)).toBe(false);

		// Row reflects the cancellation, transcript_ref preserved from submit
		const finalRow = getTaskById(db, task_id);
		expect(finalRow?.status).toBe("cancelled");
		expect(finalRow?.transcript_ref).toContain(".cuekit/tasks/");
	});

	it("status() flips an orphaned pane to failed", async () => {
		const result = await adapter.submit({
			spec: { agent_kind: "claude-code", objective: "to be orphaned" },
			session_id: "s1",
		});
		if (!result.ok) throw new Error("setup failed");
		const task_id = result.value.task_id;

		// Kill the tmux session out-of-band — cuekit should detect this on
		// the next status read.
		const sessionName = panes.sessionNameFor(task_id);
		await Bun.spawn(["tmux", "kill-session", "-t", sessionName]).exited;

		const view = await adapter.status(task_id);
		expect(view.status).toBe("failed");
	});

	it("steer() delivers send-keys against the real pane", async () => {
		const result = await adapter.submit({
			spec: { agent_kind: "claude-code", objective: "wait for steering" },
			session_id: "s1",
		});
		if (!result.ok) throw new Error("setup failed");
		const task_id = result.value.task_id;

		const ack = await adapter.steer({
			task_id,
			message: "keep going",
		});
		expect(ack.ok).toBe(true);
	});
});
