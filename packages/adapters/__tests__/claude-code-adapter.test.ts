import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { taskArtifactPaths } from "@cuekit/core";
import { createSession, getTaskById, runMigrations } from "@cuekit/store";
import { createClaudeCodeAdapter } from "../src/claude-code-adapter.ts";
import { PaneBackend } from "../src/pane-backend.ts";
import { createPiAdapter } from "../src/pi-adapter.ts";
import { FakeTmuxRunner } from "../src/testing.ts";

let db: Database;
let runner: FakeTmuxRunner;
let adapter: ReturnType<typeof createClaudeCodeAdapter>;

beforeEach(() => {
	db = new Database(":memory:");
	db.exec("pragma foreign_keys = ON;");
	runMigrations(db);
	createSession(db, {
		id: "s1",
		project_root: "/p",
		worktree_path: "/w",
		parent_agent_kind: "claude-code",
	});
	runner = new FakeTmuxRunner();
	const panes = new PaneBackend({ runner, sendKeysDelayMs: 0 });
	adapter = createClaudeCodeAdapter(db, panes, {
		launchCommandOverride: () => "sleep 60",
	});
});

describe("capabilities()", () => {
	it("declares steering + attach + model selection honestly", () => {
		const caps = adapter.capabilities();
		expect(caps.agent_kind).toBe("claude-code");
		expect(caps.supports_steering).toBe(true);
		expect(caps.supports_attach).toBe(true);
		expect(caps.supports_model_selection).toBe(true);
		expect(caps.available_models).toContain("sonnet");
		expect(caps.default_mode).toBe("interactive");
		expect(caps.supported_modes).toEqual(["interactive", "batch"]);
	});

	it("respects a custom availableModels option (round-trip)", () => {
		const customPanes = new PaneBackend({ runner, sendKeysDelayMs: 0 });
		const custom = createClaudeCodeAdapter(db, customPanes, {
			availableModels: ["haiku"],
			launchCommandOverride: () => "sleep 60",
		});
		expect(custom.capabilities().available_models).toEqual(["haiku"]);
	});
});

describe("submit", () => {
	it("creates a queued task, spawns a pane, records pane_id and flips to running", async () => {
		const result = await adapter.submit({
			spec: {
				agent_kind: "claude-code",
				objective: "Add retry logic",
				model: "sonnet",
			},
			session_id: "s1",
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const task_id = result.value.task_id;
		const task = getTaskById(db, task_id);
		expect(task?.status).toBe("running");
		expect(task?.agent_kind).toBe("claude-code");
		expect(task?.model).toBe("sonnet");
		expect(task?.native_task_ref).toMatch(/^%\d+$/);
		expect(runner.calls[0]?.[0]).toBe("new-session");
	});

	it("generates a child reporting token, stores only its hash, and injects raw env", async () => {
		const result = await adapter.submit({
			spec: { agent_kind: "claude-code", objective: "Add reporting" },
			session_id: "s1",
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const task = getTaskById(db, result.value.task_id);
		const newSession = runner.calls.find((c) => c[0] === "new-session") ?? [];
		const taskEnv = newSession.find((arg) => arg === `CUEKIT_TASK_ID=${result.value.task_id}`);
		const tokenEnv = newSession.find((arg) => arg.startsWith("CUEKIT_CHILD_TOKEN="));
		const rawToken = tokenEnv?.slice("CUEKIT_CHILD_TOKEN=".length) ?? "";

		expect(taskEnv).toBeDefined();
		expect(newSession[newSession.length - 1]).not.toContain("CUEKIT_CHILD_TOKEN");
		expect(rawToken).not.toBe("");
		expect(task?.child_token_hash).toBe(
			`sha256:${createHash("sha256").update(rawToken).digest("hex")}`,
		);
		expect(task?.child_token_hash).not.toContain(rawToken);
	});

	it("rejects when spec.agent_kind does not match adapter kind", async () => {
		const result = await adapter.submit({
			spec: { agent_kind: "pi", objective: "x" },
			session_id: "s1",
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("invalid_input");
		}
	});

	it("rejects model not in available_models (fast-fail pre-flight)", async () => {
		const result = await adapter.submit({
			spec: {
				agent_kind: "claude-code",
				objective: "x",
				model: "gpt-4",
			},
			session_id: "s1",
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("invalid_input");
		}
		// Should not have reached tmux at all
		expect(runner.calls).toHaveLength(0);
	});

	it("rejects unknown session_id with session_not_found (no FK error leaks)", async () => {
		// Earlier revisions returned `invalid_input` here, but the spec
		// sync in #40 carved out `session_not_found` as the canonical
		// code for "session id is well-formed but the row is missing"
		// (matches what delete_session returns).
		const result = await adapter.submit({
			spec: { agent_kind: "claude-code", objective: "x" },
			session_id: "s_missing",
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("session_not_found");
			expect(result.error.message).toContain("s_missing");
		}
		// And nothing in tmux either
		expect(runner.calls).toHaveLength(0);
	});

	it("defaults cwd to the session's worktree_path when spec.cwd is omitted", async () => {
		const result = await adapter.submit({
			spec: { agent_kind: "claude-code", objective: "x" },
			session_id: "s1",
		});
		if (!result.ok) throw new Error("setup failed");
		const newSession = runner.calls.find((c) => c[0] === "new-session");
		const cwdIdx = newSession?.indexOf("-c") ?? -1;
		expect(newSession?.[cwdIdx + 1]).toBe("/w");
	});

	it("soft-falls-back to no transcript capture when cwd is not writable", async () => {
		// /dev/null is a character device; attempting to mkdir under it
		// fails with ENOTDIR. Submit must still succeed (runtime still runs)
		// and transcript_ref must stay null. A warning also goes to stderr —
		// intercepting it reliably in bun:test is fiddly so we verify the
		// behavioral outcome; the warning message is covered by a manual
		// stderr inspection in dev.
		const result = await adapter.submit({
			spec: {
				agent_kind: "claude-code",
				objective: "x",
				cwd: "/dev/null/cuekit-test",
			},
			session_id: "s1",
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const task = getTaskById(db, result.value.task_id);
		expect(task?.transcript_ref).toBeNull();
		expect(task?.status).toBe("running");
	});

	it("marks the task failed and returns submit_failed when tmux spawn fails", async () => {
		runner.queueResponse({ stdout: "", stderr: "tmux: boom", exitCode: 1 });
		const result = await adapter.submit({
			spec: { agent_kind: "claude-code", objective: "x" },
			session_id: "s1",
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("submit_failed");
		}
	});

	it("cleans up the orphan .cuekit/tasks/<id>/ dir on spawn failure (P2-6)", async () => {
		// When mkdirSync succeeds but tmux spawn fails, the per-task
		// dir would otherwise remain empty on disk (no transcript ever
		// flushes, no sentinel ever writes). Operators had to gc by
		// hand. Submit now removes the dir on the failure path.
		const { existsSync, mkdtempSync, rmSync } = await import("node:fs");
		const { tmpdir: osTmpdir } = await import("node:os");
		const { join: pathJoin } = await import("node:path");
		const tmp = mkdtempSync(pathJoin(osTmpdir(), "cuekit-orphan-"));
		try {
			createSession(db, {
				id: "s_tmp",
				project_root: tmp,
				worktree_path: tmp,
				parent_agent_kind: "claude-code",
			});
			runner.queueResponse({ stdout: "", stderr: "tmux: boom", exitCode: 1 });
			const result = await adapter.submit({
				spec: { agent_kind: "claude-code", cwd: tmp, objective: "x" },
				session_id: "s_tmp",
			});
			expect(result.ok).toBe(false);
			// The .cuekit/tasks/* dir for this task must NOT linger.
			const tasksDir = pathJoin(tmp, ".cuekit", "tasks");
			if (existsSync(tasksDir)) {
				const { readdirSync } = await import("node:fs");
				const entries = readdirSync(tasksDir);
				expect(entries).toHaveLength(0);
			}
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});
});

describe("status", () => {
	it("returns the running view with attach_hint while the pane is alive", async () => {
		const result = await adapter.submit({
			spec: { agent_kind: "claude-code", objective: "x" },
			session_id: "s1",
		});
		if (!result.ok) throw new Error("setup failed");
		const view = await adapter.status(result.value.task_id);
		expect(view.status).toBe("running");
		expect(view.attach_hint).toBeDefined();
		expect(view.supports_attach).toBe(true);
	});

	it("marks orphaned non-terminal tasks failed when the pane is gone", async () => {
		const result = await adapter.submit({
			spec: { agent_kind: "claude-code", objective: "x" },
			session_id: "s1",
		});
		if (!result.ok) throw new Error("setup failed");
		// Simulate tmux session disappearing without cuekit knowing
		await runner.run(["kill-session", "-t", `cuekit-task-${result.value.task_id}`]);
		const view = await adapter.status(result.value.task_id);
		expect(view.status).toBe("failed");
		expect(view.attach_hint).toBeUndefined();
	});

	it("returns task_not_found for unknown task", async () => {
		const view = await adapter.status("t_nope");
		expect(view.status).toBe("failed");
		expect(view.error?.code).toBe("task_not_found");
	});

	it("returns permission_denied for a task owned by a different adapter (cross-adapter guard)", async () => {
		// Oracle P2-4 (v0): cross-adapter access is `permission_denied`,
		// not `task_not_found`. The row exists; the caller routed it to
		// the wrong runtime. Conflating the two codes blinds operators
		// to a real control-surface routing bug.
		const piAdapter = createPiAdapter(db, new PaneBackend({ runner, sendKeysDelayMs: 0 }), {
			launchCommandOverride: () => "sleep 60",
		});
		const piResult = await piAdapter.submit({
			spec: { agent_kind: "pi", objective: "x" },
			session_id: "s1",
		});
		if (!piResult.ok) throw new Error("setup failed");
		const view = await adapter.status(piResult.value.task_id);
		expect(view.status).toBe("failed");
		expect(view.error?.code).toBe("permission_denied");
		expect(view.error?.message).toContain("pi");
		expect(view.error?.message).toContain("claude-code");
		expect(view.error?.details).toMatchObject({
			owning_agent_kind: "pi",
			attempted_by: "claude-code",
		});
		// Regression for Oracle re-review P1-4: the cross-adapter
		// rejection path used to emit `created_at = updated_at =
		// "1970-01-01..."` to satisfy a stricter schema. Now the
		// envelope must be honest and omit them.
		expect(view.created_at).toBeUndefined();
		expect(view.updated_at).toBeUndefined();
	});
});

describe("steer", () => {
	it("issues send-keys -l followed by Enter for a running task", async () => {
		const result = await adapter.submit({
			spec: { agent_kind: "claude-code", objective: "x" },
			session_id: "s1",
		});
		if (!result.ok) throw new Error("setup failed");
		const before = runner.calls.length;
		const ack = await adapter.steer({
			task_id: result.value.task_id,
			message: "also handle retries",
		});
		expect(ack.ok).toBe(true);
		const sends = runner.calls.slice(before).filter((c) => c[0] === "send-keys");
		expect(sends).toHaveLength(2);
		expect(sends[0]).toContain("-l");
		expect(sends[0]).toContain("also handle retries");
		expect(sends[1]).toContain("Enter");
	});

	it("returns invalid_state when the task is already terminal", async () => {
		const result = await adapter.submit({
			spec: { agent_kind: "claude-code", objective: "x" },
			session_id: "s1",
		});
		if (!result.ok) throw new Error("setup failed");
		await adapter.cancel(result.value.task_id);
		const ack = await adapter.steer({
			task_id: result.value.task_id,
			message: "too late",
		});
		expect(ack.ok).toBe(false);
		if (!ack.ok) {
			expect(ack.error.code).toBe("invalid_state");
		}
	});

	it("returns task_not_found for unknown id", async () => {
		const ack = await adapter.steer({ task_id: "t_nope", message: "..." });
		expect(ack.ok).toBe(false);
		if (!ack.ok) {
			expect(ack.error.code).toBe("task_not_found");
		}
	});

	it("wraps tmux send-keys failures as transport_error", async () => {
		const result = await adapter.submit({
			spec: { agent_kind: "claude-code", objective: "x" },
			session_id: "s1",
		});
		if (!result.ok) throw new Error("setup failed");
		// Queue a failure for the NEXT call (which will be has-session in steer)
		// — easiest to trigger send-keys failure: succeed has-session then fail
		// the -l send-keys.
		runner.queueResponse({ stdout: "", stderr: "", exitCode: 0 }); // has-session ok
		runner.queueResponse({ stdout: "", stderr: "tmux: broken pipe", exitCode: 1 }); // send-keys -l fails
		const ack = await adapter.steer({
			task_id: result.value.task_id,
			message: "hi",
		});
		expect(ack.ok).toBe(false);
		if (!ack.ok) {
			expect(ack.error.code).toBe("transport_error");
		}
	});
});

describe("cancel", () => {
	it("kills the pane and marks the task cancelled", async () => {
		const result = await adapter.submit({
			spec: { agent_kind: "claude-code", objective: "x" },
			session_id: "s1",
		});
		if (!result.ok) throw new Error("setup failed");
		const ack = await adapter.cancel(result.value.task_id);
		expect(ack.ok).toBe(true);
		const task = getTaskById(db, result.value.task_id);
		expect(task?.status).toBe("cancelled");
		expect(task?.completed_at).not.toBeNull();
	});

	it("returns invalid_state if already terminal", async () => {
		const result = await adapter.submit({
			spec: { agent_kind: "claude-code", objective: "x" },
			session_id: "s1",
		});
		if (!result.ok) throw new Error("setup failed");
		await adapter.cancel(result.value.task_id);
		const ack = await adapter.cancel(result.value.task_id);
		expect(ack.ok).toBe(false);
	});

	it("returns permission_denied for cross-adapter task (guard)", async () => {
		const piAdapter = createPiAdapter(db, new PaneBackend({ runner, sendKeysDelayMs: 0 }), {
			launchCommandOverride: () => "sleep 60",
		});
		const piResult = await piAdapter.submit({
			spec: { agent_kind: "pi", objective: "x" },
			session_id: "s1",
		});
		if (!piResult.ok) throw new Error("setup failed");
		const ack = await adapter.cancel(piResult.value.task_id);
		expect(ack.ok).toBe(false);
		if (!ack.ok) {
			// P2-4 (v0): cross-adapter access is permission_denied, not task_not_found.
			expect(ack.error.code).toBe("permission_denied");
		}
		// Pi's task should remain untouched
		const piTask = getTaskById(db, piResult.value.task_id);
		expect(piTask?.status).toBe("running");
	});
});

describe("collect", () => {
	it("returns invalid_state for non-terminal tasks", async () => {
		const result = await adapter.submit({
			spec: { agent_kind: "claude-code", objective: "x" },
			session_id: "s1",
		});
		if (!result.ok) throw new Error("setup failed");
		const col = await adapter.collect(result.value.task_id);
		expect(col.ok).toBe(false);
		if (!col.ok) {
			expect(col.error.code).toBe("invalid_state");
		}
	});

	it("returns a normalized TaskResult for a cancelled task", async () => {
		const result = await adapter.submit({
			spec: { agent_kind: "claude-code", objective: "x" },
			session_id: "s1",
		});
		if (!result.ok) throw new Error("setup failed");
		await adapter.cancel(result.value.task_id);
		const col = await adapter.collect(result.value.task_id);
		expect(col.ok).toBe(true);
		if (col.ok) {
			expect(col.value.task_id).toBe(result.value.task_id);
			expect(col.value.status).toBe("cancelled");
			expect(col.value.summary).toContain("cancelled");
		}
	});

	it("returns task_not_found for unknown id", async () => {
		const col = await adapter.collect("t_nope");
		expect(col.ok).toBe(false);
		if (!col.ok) {
			expect(col.error.code).toBe("task_not_found");
		}
	});
});

describe("list (agent_kind safety)", () => {
	it("returns only this adapter's tasks when agent_kind is omitted", async () => {
		await adapter.submit({
			session_id: "s1",
			spec: { agent_kind: "claude-code", cwd: "/w", objective: "a" },
		});
		// Insert a task from a different adapter directly, so we can
		// verify `list()` does not leak it.
		const pi = createPiAdapter(db, new PaneBackend({ runner, sendKeysDelayMs: 0 }), {
			launchCommandOverride: () => "sleep 60",
		});
		await pi.submit({
			session_id: "s1",
			spec: { agent_kind: "pi", cwd: "/w", objective: "b" },
		});

		const rows = await adapter.list();
		expect(rows.every((t) => t.agent_kind === "claude-code")).toBe(true);
		expect(rows).toHaveLength(1);
	});

	it("rejects a caller-supplied agent_kind that conflicts with the adapter", () => {
		expect(adapter.list({ agent_kind: "pi" })).rejects.toThrow(
			/cannot list tasks for agent_kind 'pi'/,
		);
	});

	it("allows a caller-supplied agent_kind that matches the adapter (no-op)", async () => {
		await adapter.submit({
			session_id: "s1",
			spec: { agent_kind: "claude-code", cwd: "/w", objective: "a" },
		});
		const rows = await adapter.list({ agent_kind: "claude-code" });
		expect(rows).toHaveLength(1);
	});
});

describe("status — pane-death terminal inference (the completed path)", () => {
	// These tests use a real temp dir so the sentinel file round-trips
	// through the same filesystem machinery production uses. The default
	// /w worktree in the outer beforeEach isn't writable, which is why
	// the bulk of the suite never exercised the sentinel path before.
	let tmpCwd: string;
	let paneDeathAdapter: ReturnType<typeof createClaudeCodeAdapter>;
	let paneDeathDb: Database;
	let paneDeathRunner: FakeTmuxRunner;

	beforeEach(() => {
		tmpCwd = mkdtempSync(join(tmpdir(), "cuekit-pane-death-"));
		paneDeathDb = new Database(":memory:");
		paneDeathDb.exec("pragma foreign_keys = ON;");
		runMigrations(paneDeathDb);
		createSession(paneDeathDb, {
			id: "s1",
			project_root: tmpCwd,
			worktree_path: tmpCwd,
			parent_agent_kind: "claude-code",
		});
		paneDeathRunner = new FakeTmuxRunner();
		paneDeathAdapter = createClaudeCodeAdapter(
			paneDeathDb,
			new PaneBackend({ runner: paneDeathRunner, sendKeysDelayMs: 0 }),
			{ launchCommandOverride: () => "sleep 60" },
		);
	});

	afterEach(() => {
		rmSync(tmpCwd, { recursive: true, force: true });
		paneDeathDb.close();
	});

	// Simulates the pane having written its exit-code sentinel and then
	// dying. The wrapped launch command would do this in production; the
	// fake runner doesn't execute shell, so the test writes the sentinel
	// directly.
	async function submitAndSimulateExit(exitCode: number | null): Promise<string> {
		const result = await paneDeathAdapter.submit({
			session_id: "s1",
			spec: { agent_kind: "claude-code", cwd: tmpCwd, objective: "x" },
		});
		if (!result.ok) throw new Error("submit failed in setup");
		const task_id = result.value.task_id;
		const paths = taskArtifactPaths(tmpCwd, task_id);
		// Submit created .cuekit/tasks/<id>/ for the transcript; write the
		// sentinel into it (or leave it missing if the test wants to
		// simulate SIGKILL).
		mkdirSync(paths.dir, { recursive: true });
		if (exitCode !== null) {
			writeFileSync(paths.exitCodePath, `cuekit_exit=${exitCode}\n`);
		}
		// Drop the tmux session so isAlive returns false on the next
		// status() call.
		await paneDeathRunner.run(["kill-session", "-t", `cuekit-task-${task_id}`]);
		return task_id;
	}

	it("transitions to `completed` when the sentinel says exit 0", async () => {
		const task_id = await submitAndSimulateExit(0);
		const view = await paneDeathAdapter.status(task_id);
		expect(view.status).toBe("completed");
		expect(view.completed_at).toBeDefined();
		// The row should also be written — status() drives completeTask.
		expect(getTaskById(paneDeathDb, task_id)?.status).toBe("completed");
	});

	it("transitions to `failed` when the sentinel says a non-zero exit", async () => {
		const task_id = await submitAndSimulateExit(137);
		const view = await paneDeathAdapter.status(task_id);
		expect(view.status).toBe("failed");
		expect(view.summary).toMatch(/exited with code 137/);
	});

	it("transitions to `failed` when the sentinel is missing (SIGKILL / host shell crash)", async () => {
		const task_id = await submitAndSimulateExit(null);
		const view = await paneDeathAdapter.status(task_id);
		expect(view.status).toBe("failed");
		expect(view.summary).toMatch(/without writing exit code/);
	});

	it("populates `started_at` (first queued→running) and `metadata.tmux_pane_id`", async () => {
		const result = await paneDeathAdapter.submit({
			session_id: "s1",
			spec: { agent_kind: "claude-code", cwd: tmpCwd, objective: "x" },
		});
		if (!result.ok) throw new Error("submit failed");
		const view = await paneDeathAdapter.status(result.value.task_id);
		expect(view.started_at).toBeDefined();
		expect(view.metadata?.tmux_session_name).toBe(`cuekit-task-${result.value.task_id}`);
		expect(view.metadata?.tmux_pane_id).toBeDefined();
	});
});
