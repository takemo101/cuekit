import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, it } from "bun:test";
import {
	AdapterRegistry,
	createClaudeCodeAdapter,
	createPiAdapter,
	PaneBackend,
} from "@cuekit/adapters";
import { FakeTmuxRunner } from "@cuekit/adapters/testing";
import {
	createSession,
	getSessionById,
	getTaskById,
	listSessionsByWorktree,
	runMigrations,
} from "@cuekit/store";
import type { CommandContext } from "../src/command-context.ts";
import { runCancelTask } from "../src/commands/cancel-task.ts";
import { runDeleteSession } from "../src/commands/delete-session.ts";
import { runDeleteTask } from "../src/commands/delete-task.ts";
import { runGetTaskResult } from "../src/commands/get-task-result.ts";
import { runGetTaskStatus } from "../src/commands/get-task-status.ts";
import { runListAdapters } from "../src/commands/list-adapters.ts";
import { runListTasks } from "../src/commands/list-tasks.ts";
import { runShowMcpConfig } from "../src/commands/show-mcp-config.ts";
import { runSteerTask } from "../src/commands/steer-task.ts";
import { runSubmitTask } from "../src/commands/submit-task.ts";

let db: Database;
let runner: FakeTmuxRunner;
let ctx: CommandContext;

beforeEach(() => {
	db = new Database(":memory:");
	db.exec("pragma foreign_keys = ON;");
	runMigrations(db);
	runner = new FakeTmuxRunner();
	const panes = new PaneBackend({ runner, sendKeysDelayMs: 0 });
	const registry = new AdapterRegistry();
	registry.register(
		createClaudeCodeAdapter(db, panes, {
			launchCommandOverride: () => "sleep 60",
		}),
	);
	registry.register(
		createPiAdapter(db, panes, {
			launchCommandOverride: () => "sleep 60",
		}),
	);
	ctx = { db, registry };
});

describe("submit-task", () => {
	it("auto-creates a session from cwd when session_id is omitted", async () => {
		const result = await runSubmitTask(ctx, {
			objective: "Add retry logic",
			agent_kind: "claude-code",
			cwd: "/my/project",
			model: "sonnet",
		});
		expect(result.accepted).toBe(true);
		if (!result.accepted) return;
		expect(result.task_id).toMatch(/^t_/);
		expect(result.session_id).toMatch(/^s_/);
		const sessions = listSessionsByWorktree(db, "/my/project");
		expect(sessions).toHaveLength(1);
		// parent_agent_kind is the orchestrator (the control surface itself),
		// NOT the child adapter being targeted.
		expect(sessions[0]?.parent_agent_kind).toBe("cuekit-cli");
	});

	it("reuses an existing active session for the same cwd", async () => {
		createSession(db, {
			id: "s_existing",
			project_root: "/my/project",
			worktree_path: "/my/project",
			parent_agent_kind: "claude-code",
		});
		const result = await runSubmitTask(ctx, {
			objective: "x",
			agent_kind: "claude-code",
			cwd: "/my/project",
		});
		if (!result.accepted) throw new Error("setup failed");
		expect(result.session_id).toBe("s_existing");
	});

	it("returns adapter_not_found when agent_kind is unregistered", async () => {
		const result = await runSubmitTask(ctx, {
			objective: "x",
			agent_kind: "nonexistent",
			cwd: "/tmp",
		});
		expect(result.accepted).toBe(false);
		if (!result.accepted) {
			expect(result.error.code).toBe("adapter_not_found");
		}
	});

	it("returns invalid_input when model is not in available_models", async () => {
		const result = await runSubmitTask(ctx, {
			objective: "x",
			agent_kind: "claude-code",
			cwd: "/tmp",
			model: "gpt-4",
		});
		expect(result.accepted).toBe(false);
		if (!result.accepted) {
			expect(result.error.code).toBe("invalid_input");
		}
	});
});

describe("get-task-status", () => {
	it("returns the running view for a submitted task", async () => {
		const submit = await runSubmitTask(ctx, {
			objective: "x",
			agent_kind: "claude-code",
			cwd: "/tmp",
		});
		if (!submit.accepted) throw new Error("setup failed");
		const view = await runGetTaskStatus(ctx, { task_id: submit.task_id });
		expect(view.status).toBe("running");
		expect(view.agent_kind).toBe("claude-code");
		expect(view.attach_hint).toContain("cuekit-task-");
	});

	it("returns task_not_found for unknown id", async () => {
		const view = await runGetTaskStatus(ctx, { task_id: "t_nope" });
		expect(view.status).toBe("failed");
		expect(view.error?.code).toBe("task_not_found");
	});

	it("does not fabricate timestamps or agent_kind for the not-found envelope", async () => {
		// Regression for Oracle re-review P1-4: earlier code filled
		// `created_at = updated_at = new Date().toISOString()` and
		// `agent_kind: "unknown"` so the schema would accept the
		// not-found case. Schema is now optional on those fields
		// precisely so the envelope can be honest.
		const view = await runGetTaskStatus(ctx, { task_id: "t_nope" });
		expect(view.created_at).toBeUndefined();
		expect(view.updated_at).toBeUndefined();
		expect(view.agent_kind).toBeUndefined();
	});
});

describe("get-task-result", () => {
	it("returns invalid_state for non-terminal task", async () => {
		const submit = await runSubmitTask(ctx, {
			objective: "x",
			agent_kind: "claude-code",
			cwd: "/tmp",
		});
		if (!submit.accepted) throw new Error("setup failed");
		const result = await runGetTaskResult(ctx, { task_id: submit.task_id });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("invalid_state");
		}
	});

	it("returns a normalized TaskResult after cancel", async () => {
		const submit = await runSubmitTask(ctx, {
			objective: "x",
			agent_kind: "claude-code",
			cwd: "/tmp",
		});
		if (!submit.accepted) throw new Error("setup failed");
		await runCancelTask(ctx, { task_id: submit.task_id });
		const result = await runGetTaskResult(ctx, { task_id: submit.task_id });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.status).toBe("cancelled");
		}
	});
});

describe("cancel-task", () => {
	it("cancels a running task and updates the row", async () => {
		const submit = await runSubmitTask(ctx, {
			objective: "x",
			agent_kind: "claude-code",
			cwd: "/tmp",
		});
		if (!submit.accepted) throw new Error("setup failed");
		const ack = await runCancelTask(ctx, { task_id: submit.task_id });
		expect(ack.ok).toBe(true);
		expect(getTaskById(db, submit.task_id)?.status).toBe("cancelled");
	});

	it("returns task_not_found for unknown id", async () => {
		const ack = await runCancelTask(ctx, { task_id: "t_nope" });
		expect(ack.ok).toBe(false);
	});
});

describe("steer-task", () => {
	it("delivers the steering message via tmux send-keys", async () => {
		const submit = await runSubmitTask(ctx, {
			objective: "x",
			agent_kind: "claude-code",
			cwd: "/tmp",
		});
		if (!submit.accepted) throw new Error("setup failed");
		const before = runner.calls.length;
		const ack = await runSteerTask(ctx, {
			task_id: submit.task_id,
			message: "change direction",
		});
		expect(ack.ok).toBe(true);
		const sendCalls = runner.calls.slice(before).filter((c) => c[0] === "send-keys");
		expect(sendCalls).toHaveLength(2);
	});

	it("returns task_not_found for unknown id", async () => {
		const ack = await runSteerTask(ctx, { task_id: "t_nope", message: "..." });
		expect(ack.ok).toBe(false);
	});
});

describe("list-tasks", () => {
	it("returns tasks across all sessions", async () => {
		await runSubmitTask(ctx, {
			objective: "a",
			agent_kind: "claude-code",
			cwd: "/tmp/one",
		});
		await runSubmitTask(ctx, {
			objective: "b",
			agent_kind: "pi",
			cwd: "/tmp/two",
		});
		const result = await runListTasks(ctx, {});
		expect(result.tasks).toHaveLength(2);
	});

	it("filters by agent_kind", async () => {
		await runSubmitTask(ctx, {
			objective: "a",
			agent_kind: "claude-code",
			cwd: "/tmp/one",
		});
		await runSubmitTask(ctx, {
			objective: "b",
			agent_kind: "pi",
			cwd: "/tmp/two",
		});
		const result = await runListTasks(ctx, { agent_kind: "pi" });
		expect(result.tasks).toHaveLength(1);
		expect(result.tasks[0]?.agent_kind).toBe("pi");
	});

	it("filters by status", async () => {
		const a = await runSubmitTask(ctx, {
			objective: "a",
			agent_kind: "claude-code",
			cwd: "/tmp/one",
		});
		await runSubmitTask(ctx, {
			objective: "b",
			agent_kind: "claude-code",
			cwd: "/tmp/two",
		});
		if (!a.accepted) throw new Error("setup failed");
		await runCancelTask(ctx, { task_id: a.task_id });
		const running = await runListTasks(ctx, { status: "running" });
		expect(running.tasks).toHaveLength(1);
		const cancelled = await runListTasks(ctx, { status: "cancelled" });
		expect(cancelled.tasks).toHaveLength(1);
	});

	it("filters by cwd (via session worktree_path)", async () => {
		await runSubmitTask(ctx, {
			objective: "a",
			agent_kind: "claude-code",
			cwd: "/tmp/one",
		});
		await runSubmitTask(ctx, {
			objective: "b",
			agent_kind: "claude-code",
			cwd: "/tmp/two",
		});
		const result = await runListTasks(ctx, { cwd: "/tmp/one" });
		expect(result.tasks).toHaveLength(1);
	});

	it("signals has_more=false and omits next_cursor when the whole set fits in one page", async () => {
		await runSubmitTask(ctx, {
			objective: "a",
			agent_kind: "claude-code",
			cwd: "/tmp/one",
		});
		const result = await runListTasks(ctx, { limit: 10 });
		expect(result.has_more).toBe(false);
		expect(result.next_cursor).toBeUndefined();
	});

	it("signals has_more=true and returns next_cursor when more rows exist beyond the page", async () => {
		for (let i = 0; i < 3; i++) {
			await runSubmitTask(ctx, {
				objective: `obj ${i}`,
				agent_kind: "claude-code",
				cwd: "/tmp/one",
			});
		}
		const first = await runListTasks(ctx, { limit: 2 });
		expect(first.tasks).toHaveLength(2);
		expect(first.has_more).toBe(true);
		expect(first.next_cursor).toBeDefined();

		// Walk the rest using next_cursor — the final page must flip
		// has_more back to false so the caller knows to stop. No overlap
		// with the first page.
		const second = await runListTasks(ctx, { limit: 2, cursor: first.next_cursor });
		expect(second.tasks).toHaveLength(1);
		expect(second.has_more).toBe(false);
		expect(second.next_cursor).toBeUndefined();
		const firstIds = new Set(first.tasks.map((t) => t.task_id));
		for (const t of second.tasks) expect(firstIds.has(t.task_id)).toBe(false);
	});
});

describe("list-adapters", () => {
	it("returns capabilities for all registered adapters", async () => {
		const result = await runListAdapters(ctx, {});
		const kinds = result.adapters.map((a) => a.agent_kind).sort();
		expect(kinds).toEqual(["claude-code", "pi"]);
	});

	it("surfaces available_models for adapters that publish them", async () => {
		const result = await runListAdapters(ctx, {});
		const claude = result.adapters.find((a) => a.agent_kind === "claude-code");
		expect(claude?.available_models).toContain("sonnet");
		const pi = result.adapters.find((a) => a.agent_kind === "pi");
		expect(pi?.supports_model_selection).toBe(false);
	});
});

describe("show-mcp-config", () => {
	it("returns defaults (name='cuekit', command='cuekit', --mcp) when called with no input", async () => {
		const result = await runShowMcpConfig(ctx, {});
		expect(result.name).toBe("cuekit");
		expect(result.command).toBe("cuekit");
		expect(result.args).toEqual(["--mcp"]);
		// Paste-ready snippet is keyed by the server name.
		expect(result.mcpServers).toEqual({
			cuekit: { command: "cuekit", args: ["--mcp"] },
		});
	});

	it("honours a custom server name (for side-by-side installs)", async () => {
		const result = await runShowMcpConfig(ctx, { name: "cuekit-prod" });
		expect(result.name).toBe("cuekit-prod");
		expect(result.mcpServers).toEqual({
			"cuekit-prod": { command: "cuekit", args: ["--mcp"] },
		});
	});

	it("honours an absolute bin path (uninstalled / workspace-linked checkouts)", async () => {
		const result = await runShowMcpConfig(ctx, {
			bin: "/Users/me/code/cuekit/packages/mcp/src/bin.ts",
		});
		expect(result.command).toBe("/Users/me/code/cuekit/packages/mcp/src/bin.ts");
		expect(result.mcpServers.cuekit?.command).toBe("/Users/me/code/cuekit/packages/mcp/src/bin.ts");
	});

	it("round-trips both overrides in the mcpServers snippet", async () => {
		const result = await runShowMcpConfig(ctx, {
			name: "staging",
			bin: "/opt/cuekit/bin/cuekit",
		});
		expect(result.mcpServers).toEqual({
			staging: { command: "/opt/cuekit/bin/cuekit", args: ["--mcp"] },
		});
	});
});

describe("delete-task", () => {
	it("deletes a terminal task and returns ok", async () => {
		const submit = await runSubmitTask(ctx, {
			objective: "x",
			agent_kind: "claude-code",
			cwd: "/tmp",
		});
		if (!submit.accepted) throw new Error("setup failed");
		await runCancelTask(ctx, { task_id: submit.task_id });
		const ack = await runDeleteTask(ctx, { task_id: submit.task_id });
		expect(ack.ok).toBe(true);
		expect(getTaskById(db, submit.task_id)).toBeNull();
	});

	it("refuses to delete a running task (caller must cancel first)", async () => {
		const submit = await runSubmitTask(ctx, {
			objective: "x",
			agent_kind: "claude-code",
			cwd: "/tmp",
		});
		if (!submit.accepted) throw new Error("setup failed");
		const ack = await runDeleteTask(ctx, { task_id: submit.task_id });
		expect(ack.ok).toBe(false);
		if (!ack.ok) {
			expect(ack.error.code).toBe("invalid_state");
			expect(ack.error.message).toMatch(/cancel it before deleting/);
		}
		// Row still present — the refuse did not accidentally succeed.
		expect(getTaskById(db, submit.task_id)).not.toBeNull();
	});

	it("returns task_not_found for unknown id", async () => {
		const ack = await runDeleteTask(ctx, { task_id: "t_nope" });
		expect(ack.ok).toBe(false);
		if (!ack.ok) expect(ack.error.code).toBe("task_not_found");
	});
});

describe("delete-session", () => {
	it("deletes a session whose tasks are all terminal, cascading to children", async () => {
		const submit = await runSubmitTask(ctx, {
			objective: "x",
			agent_kind: "claude-code",
			cwd: "/tmp",
		});
		if (!submit.accepted) throw new Error("setup failed");
		await runCancelTask(ctx, { task_id: submit.task_id });
		const ack = await runDeleteSession(ctx, { session_id: submit.session_id });
		expect(ack.ok).toBe(true);
		expect(getSessionById(db, submit.session_id)).toBeNull();
		expect(getTaskById(db, submit.task_id)).toBeNull();
	});

	it("deletes an empty session (no tasks) — valid terminal state", async () => {
		createSession(db, {
			id: "s_empty",
			project_root: "/p",
			worktree_path: "/w",
			parent_agent_kind: "pi",
		});
		const ack = await runDeleteSession(ctx, { session_id: "s_empty" });
		expect(ack.ok).toBe(true);
		expect(getSessionById(db, "s_empty")).toBeNull();
	});

	it("refuses to delete a session with active tasks", async () => {
		const submit = await runSubmitTask(ctx, {
			objective: "x",
			agent_kind: "claude-code",
			cwd: "/tmp",
		});
		if (!submit.accepted) throw new Error("setup failed");
		// Task is still running — deletion must be blocked.
		const ack = await runDeleteSession(ctx, { session_id: submit.session_id });
		expect(ack.ok).toBe(false);
		if (!ack.ok) {
			expect(ack.error.code).toBe("invalid_state");
			expect(ack.error.message).toMatch(/active task/);
		}
		// Both rows still present — block is complete, not partial.
		expect(getSessionById(db, submit.session_id)).not.toBeNull();
		expect(getTaskById(db, submit.task_id)).not.toBeNull();
	});

	it("returns session_not_found for unknown id", async () => {
		const ack = await runDeleteSession(ctx, { session_id: "s_nope" });
		expect(ack.ok).toBe(false);
		if (!ack.ok) expect(ack.error.code).toBe("session_not_found");
	});
});
