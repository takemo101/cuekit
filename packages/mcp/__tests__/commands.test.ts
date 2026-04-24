import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, it } from "bun:test";
import {
	AdapterRegistry,
	createClaudeCodeAdapter,
	createPiAdapter,
	PaneBackend,
	type TmuxRunner,
	type TmuxRunResult,
} from "@cuekit/adapters";
import { createSession, getTaskById, listSessionsByWorktree, runMigrations } from "@cuekit/store";
import type { CommandContext } from "../src/command-context.ts";
import { runCancelTask } from "../src/commands/cancel-task.ts";
import { runGetTaskResult } from "../src/commands/get-task-result.ts";
import { runGetTaskStatus } from "../src/commands/get-task-status.ts";
import { runListAdapters } from "../src/commands/list-adapters.ts";
import { runListTasks } from "../src/commands/list-tasks.ts";
import { runSteerTask } from "../src/commands/steer-task.ts";
import { runSubmitTask } from "../src/commands/submit-task.ts";

// Minimal FakeTmuxRunner (mirrors the one in @cuekit/adapters/__tests__).
// The adapters package does not currently export its FakeTmuxRunner, so
// re-declare a lightweight local copy.
class FakeTmuxRunner implements TmuxRunner {
	readonly calls: string[][] = [];
	private readonly sessions = new Set<string>();
	private paneCounter = 0;

	async run(args: string[]): Promise<TmuxRunResult> {
		this.calls.push([...args]);
		const cmd = args[0];
		switch (cmd) {
			case "new-session": {
				const name = args[args.indexOf("-s") + 1];
				if (name) this.sessions.add(name);
				this.paneCounter += 1;
				return { stdout: `%${this.paneCounter}\n`, stderr: "", exitCode: 0 };
			}
			case "has-session": {
				const name = args[args.indexOf("-t") + 1];
				return {
					stdout: "",
					stderr: "",
					exitCode: name && this.sessions.has(name) ? 0 : 1,
				};
			}
			case "kill-session": {
				const name = args[args.indexOf("-t") + 1];
				if (name) this.sessions.delete(name);
				return { stdout: "", stderr: "", exitCode: 0 };
			}
			default:
				return { stdout: "", stderr: "", exitCode: 0 };
		}
	}
}

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
	ctx = { db, panes, registry };
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
		expect(sessions[0]?.parent_agent_kind).toBe("claude-code");
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
