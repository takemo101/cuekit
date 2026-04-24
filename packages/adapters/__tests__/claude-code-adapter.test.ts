import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, it } from "bun:test";
import { createSession, getTaskById, runMigrations } from "@cuekit/store";
import { createClaudeCodeAdapter } from "../src/claude-code-adapter.ts";
import { PaneBackend } from "../src/pane-backend.ts";
import { FakeTmuxRunner } from "./fake-tmux-runner.ts";

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
		expect(task?.target_agent_kind).toBe("claude-code");
		expect(task?.model).toBe("sonnet");
		expect(task?.native_task_ref).toMatch(/^%\d+$/);
		expect(runner.calls[0]?.[0]).toBe("new-session");
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
