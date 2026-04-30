import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, it } from "bun:test";
import { relative, resolve } from "node:path";
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
	listTaskEvents,
	runMigrations,
	updateTaskChildTokenHash,
} from "@cuekit/store";
import type { CommandContext } from "../src/command-context.ts";
import { runCancelTasks } from "../src/commands/cancel-task.ts";
import { runCleanupTasks } from "../src/commands/cleanup-tasks.ts";
import { runDeleteSessions } from "../src/commands/delete-session.ts";
import { runDeleteTasks } from "../src/commands/delete-task.ts";
import { runGetTaskResult } from "../src/commands/get-task-result.ts";
import { runGetTaskStatus } from "../src/commands/get-task-status.ts";
import { runListAdapters } from "../src/commands/list-adapters.ts";
import { runListTaskEvents } from "../src/commands/list-task-events.ts";
import { runListTasks } from "../src/commands/list-tasks.ts";
import { runReportTaskEvent } from "../src/commands/report-task-event.ts";
import { runShowMcpConfig } from "../src/commands/show-mcp-config.ts";
import { runSteerTask } from "../src/commands/steer-task.ts";
import { runSubmitTask } from "../src/commands/submit-task.ts";
import { runWaitTasks } from "../src/commands/wait-tasks.ts";

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

	it("accepts the full TaskSpec shape — context / constraints / inputs / expected_output (P2-3)", async () => {
		// Earlier the SubmitTaskInputSchema was hand-written and silently
		// dropped these four optional protocol fields. Now the schema is
		// derived from `TaskSpecSchema` so anything the protocol accepts
		// flows through. Verifies the schema accepts the shape (Zod
		// validates).
		const result = await runSubmitTask(ctx, {
			objective: "Resolve flaky test",
			agent_kind: "claude-code",
			cwd: "/tmp",
			context: "The test is in __tests__/foo.test.ts and fails ~3% of runs.",
			constraints: ["must pass under bun test --bail", "no new dependencies"],
			inputs: [{ kind: "text", ref: "see context", title: "background" }],
			expected_output: { format: "summary", require_tests: true },
		});
		expect(result.accepted).toBe(true);
	});

	it("normalizes cwd before passing the TaskSpec to the adapter", async () => {
		const cwd = relative(process.cwd(), "/tmp");
		const result = await runSubmitTask(ctx, {
			objective: "x",
			agent_kind: "claude-code",
			cwd,
		});
		expect(result.accepted).toBe(true);
		if (!result.accepted) return;
		const call = runner.calls.find((c) => c[0] === "new-session") ?? [];
		expect(call).toContain(resolve(cwd));
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
		expect("task_id" in result).toBe(false);
		if (!("task_id" in result)) {
			expect(result.error.code).toBe("invalid_state");
			expect(result.error.retryable).toBe(true);
		}
	});

	it("returns a normalized TaskResult after cancel", async () => {
		const submit = await runSubmitTask(ctx, {
			objective: "x",
			agent_kind: "claude-code",
			cwd: "/tmp",
		});
		if (!submit.accepted) throw new Error("setup failed");
		await runCancelTasks(ctx, { task_ids: [submit.task_id] });
		const result = await runGetTaskResult(ctx, { task_id: submit.task_id });
		expect("task_id" in result).toBe(true);
		if ("task_id" in result) expect(result.status).toBe("cancelled");
	});

	it("refreshes a non-terminal task before collect so timeout_ms is enforced", async () => {
		const submit = await runSubmitTask(ctx, {
			objective: "x",
			agent_kind: "claude-code",
			cwd: "/tmp",
			timeout_ms: 1,
		});
		if (!submit.accepted) throw new Error("setup failed");
		await Bun.sleep(5);
		const result = await runGetTaskResult(ctx, { task_id: submit.task_id });
		expect("task_id" in result).toBe(true);
		if ("task_id" in result) expect(result.status).toBe("timed_out");
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
		const ack = await runCancelTasks(ctx, { task_ids: [submit.task_id] });
		expect(ack.ok).toBe(true);
		expect(getTaskById(db, submit.task_id)?.status).toBe("cancelled");
	});

	it("returns task_not_found for unknown id", async () => {
		const ack = await runCancelTasks(ctx, { task_ids: ["t_nope"] });
		expect(ack.ok).toBe(false);
	});
});

describe("report-task-event", () => {
	async function submitWithChildToken() {
		const submit = await runSubmitTask(ctx, {
			objective: "x",
			agent_kind: "claude-code",
			cwd: "/tmp",
		});
		if (!submit.accepted) throw new Error("setup failed");
		updateTaskChildTokenHash(
			db,
			submit.task_id,
			"sha256:3a6eb0790f39ac87c94f3856b2dd2c5d110e6811602261a9a923d3bb23adc8b7",
		);
		return submit.task_id;
	}

	it("appends a progress event after validating the child token", async () => {
		const task_id = await submitWithChildToken();
		const result = await runReportTaskEvent(ctx, {
			task_id,
			child_token: "data",
			type: "progress",
			message: "Running tests",
			payload: { command: "bun test" },
		});

		expect(result.ok).toBe(true);
		const events = listTaskEvents(db, task_id);
		expect(events).toHaveLength(1);
		expect(events[0]?.type).toBe("progress");
		expect(events[0]?.payload).toEqual({ command: "bun test" });
		expect(getTaskById(db, task_id)?.status).toBe("running");
	});

	it("falls back to CUEKIT_TASK_ID and CUEKIT_CHILD_TOKEN", async () => {
		const task_id = await submitWithChildToken();
		const previousTaskId = process.env.CUEKIT_TASK_ID;
		const previousToken = process.env.CUEKIT_CHILD_TOKEN;
		process.env.CUEKIT_TASK_ID = task_id;
		process.env.CUEKIT_CHILD_TOKEN = "data";
		try {
			const result = await runReportTaskEvent(ctx, { type: "progress", message: "wip" });
			expect(result.ok).toBe(true);
			expect(listTaskEvents(db, task_id)).toHaveLength(1);
		} finally {
			if (previousTaskId === undefined) delete process.env.CUEKIT_TASK_ID;
			else process.env.CUEKIT_TASK_ID = previousTaskId;
			if (previousToken === undefined) delete process.env.CUEKIT_CHILD_TOKEN;
			else process.env.CUEKIT_CHILD_TOKEN = previousToken;
		}
	});

	it("terminal reports update task status without waiting for process exit", async () => {
		const task_id = await submitWithChildToken();
		const result = await runReportTaskEvent(ctx, {
			task_id,
			child_token: "data",
			type: "completed",
			message: "Done",
		});

		expect(result.ok).toBe(true);
		expect(getTaskById(db, task_id)?.status).toBe("completed");
		expect(listTaskEvents(db, task_id).map((event) => event.type)).toEqual(["completed"]);
	});

	it("failed reports set the child-declared failed status", async () => {
		const task_id = await submitWithChildToken();
		const result = await runReportTaskEvent(ctx, {
			task_id,
			child_token: "data",
			type: "failed",
			message: "Tests failed",
		});

		expect(result.ok).toBe(true);
		expect(getTaskById(db, task_id)?.status).toBe("failed");
	});

	it("blocked reports set the child-declared blocked status", async () => {
		const task_id = await submitWithChildToken();
		const result = await runReportTaskEvent(ctx, {
			task_id,
			child_token: "data",
			type: "blocked",
			message: "Need product clarification",
		});

		expect(result.ok).toBe(true);
		expect(getTaskById(db, task_id)?.status).toBe("blocked");
	});

	it("accepts non-terminal help_requested and log report types", async () => {
		const task_id = await submitWithChildToken();
		await runReportTaskEvent(ctx, {
			task_id,
			child_token: "data",
			type: "help_requested",
			message: "Which migration should I use?",
		});
		await runReportTaskEvent(ctx, {
			task_id,
			child_token: "data",
			type: "log",
			message: "debug note",
		});

		expect(listTaskEvents(db, task_id).map((event) => event.type)).toEqual([
			"help_requested",
			"log",
		]);
		expect(getTaskById(db, task_id)?.status).toBe("running");
	});

	it("rejects invalid child tokens without appending an event", async () => {
		const task_id = await submitWithChildToken();
		const result = await runReportTaskEvent(ctx, {
			task_id,
			child_token: "wrong",
			type: "progress",
			message: "wip",
		});

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("permission_denied");
		expect(listTaskEvents(db, task_id)).toEqual([]);
	});

	it("rejects malformed JSON-looking payload strings", async () => {
		const task_id = await submitWithChildToken();
		const result = await runReportTaskEvent(ctx, {
			task_id,
			child_token: "data",
			type: "progress",
			payload: "{bad",
		});

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("invalid_input");
		expect(listTaskEvents(db, task_id)).toEqual([]);
	});
});

describe("list-task-events", () => {
	it("returns task events in canonical sequence order", async () => {
		const submit = await runSubmitTask(ctx, {
			objective: "x",
			agent_kind: "claude-code",
			cwd: "/tmp",
		});
		if (!submit.accepted) throw new Error("setup failed");
		updateTaskChildTokenHash(
			db,
			submit.task_id,
			"sha256:3a6eb0790f39ac87c94f3856b2dd2c5d110e6811602261a9a923d3bb23adc8b7",
		);
		await runReportTaskEvent(ctx, {
			task_id: submit.task_id,
			child_token: "data",
			type: "progress",
			message: "Running tests",
		});
		await runReportTaskEvent(ctx, {
			task_id: submit.task_id,
			child_token: "data",
			type: "completed",
			message: "Done",
		});

		const result = await runListTaskEvents(ctx, { task_id: submit.task_id });
		expect("events" in result).toBe(true);
		if ("events" in result) {
			expect(result.events.map((event) => event.type)).toEqual(["progress", "completed"]);
			expect(result.events[0]?.message).toBe("Running tests");
		}
	});

	it("returns task_not_found for unknown tasks", async () => {
		const result = await runListTaskEvents(ctx, { task_id: "missing" });
		expect("error" in result).toBe(true);
		if ("error" in result) expect(result.error.code).toBe("task_not_found");
	});
});

describe("wait-tasks", () => {
	it("timeout_ms 0 returns a non-blocking snapshot without cancelling the task", async () => {
		const submitted = await runSubmitTask(ctx, {
			objective: "x",
			agent_kind: "claude-code",
			cwd: "/my/project",
		});
		if (!submitted.accepted) throw new Error("setup failed");

		const waited = await runWaitTasks(ctx, {
			task_ids: [submitted.task_id],
			session_id: submitted.session_id,
			timeout_ms: 0,
			poll_interval_ms: 1,
		});

		expect(waited.done).toBe(false);
		expect(waited.timed_out).toBe(true);
		expect(waited.tasks).toHaveLength(1);
		expect(waited.tasks[0]?.status).toBe("running");
		expect(getTaskById(db, submitted.task_id)?.status).toBe("running");
	});

	it("returns immediately when all scoped tasks are already terminal", async () => {
		const submitted = await runSubmitTask(ctx, {
			objective: "x",
			agent_kind: "claude-code",
			cwd: "/my/project",
		});
		if (!submitted.accepted) throw new Error("setup failed");
		await runCancelTasks(ctx, { task_ids: [submitted.task_id] });

		const waited = await runWaitTasks(ctx, {
			task_ids: [submitted.task_id],
			session_id: submitted.session_id,
			mode: "all",
			timeout_ms: 1,
			poll_interval_ms: 1,
			include_results: true,
		});

		expect(waited.done).toBe(true);
		expect(waited.timed_out).toBe(false);
		expect(waited.tasks).toHaveLength(1);
		expect(waited.tasks[0]?.status).toBe("cancelled");
		expect(waited.tasks[0]?.terminal).toBe(true);
		expect(waited.tasks[0]?.result?.status).toBe("cancelled");
	});

	it("all mode waits until every task is terminal", async () => {
		const first = await runSubmitTask(ctx, {
			objective: "first",
			agent_kind: "claude-code",
			cwd: "/my/project",
		});
		const second = await runSubmitTask(ctx, {
			objective: "second",
			agent_kind: "claude-code",
			cwd: "/my/project",
		});
		if (!first.accepted || !second.accepted) throw new Error("setup failed");

		const waitPromise = runWaitTasks(ctx, {
			task_ids: [first.task_id, second.task_id],
			session_id: first.session_id,
			mode: "all",
			timeout_ms: 1000,
			poll_interval_ms: 5,
		});
		setTimeout(() => {
			void runCancelTasks(ctx, { task_ids: [first.task_id] });
		}, 1);
		setTimeout(() => {
			void runCancelTasks(ctx, { task_ids: [second.task_id] });
		}, 10);

		const waited = await waitPromise;

		expect(waited.done).toBe(true);
		expect(waited.tasks.map((task) => task.status).sort()).toEqual(["cancelled", "cancelled"]);
	});

	it("stop_on_failed returns early for failure-like statuses without waiting for all tasks", async () => {
		const first = await runSubmitTask(ctx, {
			objective: "first",
			agent_kind: "claude-code",
			cwd: "/my/project",
		});
		const second = await runSubmitTask(ctx, {
			objective: "second",
			agent_kind: "claude-code",
			cwd: "/my/project",
		});
		if (!first.accepted || !second.accepted) throw new Error("setup failed");
		updateTaskChildTokenHash(
			db,
			first.task_id,
			"sha256:3a6eb0790f39ac87c94f3856b2dd2c5d110e6811602261a9a923d3bb23adc8b7",
		);

		const waitPromise = runWaitTasks(ctx, {
			task_ids: [first.task_id, second.task_id],
			session_id: first.session_id,
			mode: "all",
			stop_on_failed: true,
			timeout_ms: 1000,
			poll_interval_ms: 5,
		});
		setTimeout(() => {
			void runReportTaskEvent(ctx, {
				task_id: first.task_id,
				child_token: "data",
				type: "failed",
				message: "failed",
			});
		}, 1);

		const waited = await waitPromise;

		expect(waited.done).toBe(true);
		expect(waited.tasks.find((task) => task.task_id === first.task_id)?.status).toBe("failed");
		expect(waited.tasks.find((task) => task.task_id === second.task_id)?.status).toBe("running");
	});

	it("waits until child reporting makes any task terminal", async () => {
		const first = await runSubmitTask(ctx, {
			objective: "first",
			agent_kind: "claude-code",
			cwd: "/my/project",
		});
		const second = await runSubmitTask(ctx, {
			objective: "second",
			agent_kind: "claude-code",
			cwd: "/my/project",
		});
		if (!first.accepted || !second.accepted) throw new Error("setup failed");
		updateTaskChildTokenHash(
			db,
			second.task_id,
			"sha256:3a6eb0790f39ac87c94f3856b2dd2c5d110e6811602261a9a923d3bb23adc8b7",
		);

		const waitPromise = runWaitTasks(ctx, {
			task_ids: [first.task_id, second.task_id],
			session_id: first.session_id,
			mode: "any",
			timeout_ms: 1000,
			poll_interval_ms: 5,
			include_events: true,
		});
		setTimeout(() => {
			void runReportTaskEvent(ctx, {
				task_id: second.task_id,
				child_token: "data",
				type: "completed",
				message: "done",
			});
		}, 1);

		const waited = await waitPromise;

		expect(waited.done).toBe(true);
		expect(waited.timed_out).toBe(false);
		expect(waited.tasks.find((task) => task.task_id === second.task_id)?.status).toBe("completed");
		expect(
			waited.tasks
				.find((task) => task.task_id === second.task_id)
				?.events?.map((event) => event.type),
		).toEqual(["completed"]);
	});

	it("rejects tasks outside the requested session scope", async () => {
		const owned = await runSubmitTask(ctx, {
			objective: "owned",
			agent_kind: "claude-code",
			cwd: "/my/project",
		});
		const foreign = await runSubmitTask(ctx, {
			objective: "foreign",
			agent_kind: "claude-code",
			cwd: "/other/project",
		});
		if (!owned.accepted || !foreign.accepted) throw new Error("setup failed");

		const waited = await runWaitTasks(ctx, {
			task_ids: [owned.task_id, foreign.task_id],
			session_id: owned.session_id,
			timeout_ms: 1,
			poll_interval_ms: 1,
		});

		expect(waited.done).toBe(false);
		expect(waited.error?.code).toBe("permission_denied");
	});

	it("rejects tasks outside the requested cwd scope", async () => {
		const submitted = await runSubmitTask(ctx, {
			objective: "x",
			agent_kind: "claude-code",
			cwd: "/my/project",
		});
		if (!submitted.accepted) throw new Error("setup failed");

		const waited = await runWaitTasks(ctx, {
			task_ids: [submitted.task_id],
			cwd: "/other/project",
			timeout_ms: 1,
			poll_interval_ms: 1,
		});

		expect(waited.error?.code).toBe("permission_denied");
	});

	it("supports single-task waiting via task_ids with one entry", async () => {
		const submitted = await runSubmitTask(ctx, {
			objective: "x",
			agent_kind: "claude-code",
			cwd: "/my/project",
		});
		if (!submitted.accepted) throw new Error("setup failed");
		await runCancelTasks(ctx, { task_ids: [submitted.task_id] });

		const waited = await runWaitTasks(ctx, {
			task_ids: [submitted.task_id],
			session_id: submitted.session_id,
			timeout_ms: 1,
			poll_interval_ms: 1,
			include_results: true,
		});

		expect(waited.done).toBe(true);
		expect(waited.tasks).toHaveLength(1);
		expect(waited.tasks[0]?.status).toBe("cancelled");
		expect(waited.tasks[0]?.terminal).toBe(true);
		expect(waited.tasks[0]?.result?.status).toBe("cancelled");
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
		if ("error" in result) throw new Error(result.error.message);
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
		if ("error" in result) throw new Error(result.error.message);
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
		await runCancelTasks(ctx, { task_ids: [a.task_id] });
		const running = await runListTasks(ctx, { status: "running" });
		if ("error" in running) throw new Error(running.error.message);
		expect(running.tasks).toHaveLength(1);
		const cancelled = await runListTasks(ctx, { status: "cancelled" });
		if ("error" in cancelled) throw new Error(cancelled.error.message);
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
		if ("error" in result) throw new Error(result.error.message);
		expect(result.tasks).toHaveLength(1);
	});

	it("normalizes relative cwd filters", async () => {
		const cwd = relative(process.cwd(), "/tmp/one");
		await runSubmitTask(ctx, {
			objective: "a",
			agent_kind: "claude-code",
			cwd,
		});
		const result = await runListTasks(ctx, { cwd });
		if ("error" in result) throw new Error(result.error.message);
		expect(result.tasks).toHaveLength(1);
	});

	it("refreshes listed non-terminal tasks so expired running tasks leave running filters", async () => {
		await runSubmitTask(ctx, {
			objective: "a",
			agent_kind: "claude-code",
			cwd: "/tmp/one",
			timeout_ms: 1,
		});
		await Bun.sleep(5);
		const result = await runListTasks(ctx, { status: "running" });
		if ("error" in result) throw new Error(result.error.message);
		expect(result.tasks).toHaveLength(0);
	});

	it("does not return probe rows before the cursor anchor after refresh filtering", async () => {
		const active = await runSubmitTask(ctx, {
			objective: "still running",
			agent_kind: "claude-code",
			cwd: "/tmp/one",
		});
		if (!active.accepted) throw new Error("setup failed");
		for (let i = 0; i < 3; i++) {
			const expired = await runSubmitTask(ctx, {
				objective: `expired ${i}`,
				agent_kind: "claude-code",
				cwd: "/tmp/one",
				timeout_ms: 1,
			});
			if (!expired.accepted) throw new Error("setup failed");
			db.prepare("update tasks set updated_at = ? where id = ?").run(
				`2026-04-24T10:00:0${3 - i}.000Z`,
				expired.task_id,
			);
		}
		db.prepare("update tasks set updated_at = ? where id = ?").run(
			"2026-04-24T10:00:00.000Z",
			active.task_id,
		);
		await Bun.sleep(5);
		const first = await runListTasks(ctx, { status: "running", limit: 2 });
		if ("error" in first) throw new Error(first.error.message);
		expect(first.tasks.map((t) => t.task_id)).not.toContain(active.task_id);
		if (!first.next_cursor) throw new Error("expected cursor");
		const second = await runListTasks(ctx, {
			status: "running",
			limit: 2,
			cursor: first.next_cursor,
		});
		if ("error" in second) throw new Error(second.error.message);
		expect(second.tasks.map((t) => t.task_id)).toContain(active.task_id);
	});

	it("finds legacy sessions stored with relative worktree_path", async () => {
		createSession(db, {
			id: "s_relative",
			project_root: ".",
			worktree_path: "legacy/relative",
			parent_agent_kind: "cuekit-cli",
		});
		const task = await runSubmitTask(ctx, {
			objective: "legacy task",
			agent_kind: "claude-code",
			session_id: "s_relative",
		});
		if (!task.accepted) throw new Error("setup failed");
		const result = await runListTasks(ctx, { cwd: "legacy/relative" });
		if ("error" in result) throw new Error(result.error.message);
		expect(result.tasks.map((t) => t.task_id)).toContain(task.task_id);
	});

	it("signals has_more=false and omits next_cursor when the whole set fits in one page", async () => {
		await runSubmitTask(ctx, {
			objective: "a",
			agent_kind: "claude-code",
			cwd: "/tmp/one",
		});
		const result = await runListTasks(ctx, { limit: 10 });
		if ("error" in result) throw new Error(result.error.message);
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
		if ("error" in first) throw new Error(first.error.message);
		expect(first.tasks).toHaveLength(2);
		expect(first.has_more).toBe(true);
		expect(first.next_cursor).toBeDefined();

		// Walk the rest using next_cursor — the final page must flip
		// has_more back to false so the caller knows to stop. No overlap
		// with the first page.
		const second = await runListTasks(ctx, { limit: 2, cursor: first.next_cursor });
		if ("error" in second) throw new Error(second.error.message);
		expect(second.tasks).toHaveLength(1);
		expect(second.has_more).toBe(false);
		expect(second.next_cursor).toBeUndefined();
		const firstIds = new Set(first.tasks.map((t) => t.task_id));
		for (const t of second.tasks) expect(firstIds.has(t.task_id)).toBe(false);
	});

	it("returns structured invalid_input for malformed cursors", async () => {
		const result = await runListTasks(ctx, { cursor: "not-json" });
		expect("error" in result).toBe(true);
		if ("error" in result) {
			expect(result.error.code).toBe("invalid_input");
			expect(result.error.message).toContain("invalid cursor");
		}
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

describe("delete-tasks", () => {
	it("deletes a terminal task and returns ok", async () => {
		const submit = await runSubmitTask(ctx, {
			objective: "x",
			agent_kind: "claude-code",
			cwd: "/tmp",
		});
		if (!submit.accepted) throw new Error("setup failed");
		await runCancelTasks(ctx, { task_ids: [submit.task_id] });
		const ack = await runDeleteTasks(ctx, { task_ids: [submit.task_id] });
		expect(ack.ok).toBe(true);
		expect(getTaskById(db, submit.task_id)).toBeNull();
	});

	it("deletes a terminal task that has child report events", async () => {
		const submit = await runSubmitTask(ctx, {
			objective: "x",
			agent_kind: "claude-code",
			cwd: "/tmp",
		});
		if (!submit.accepted) throw new Error("setup failed");
		updateTaskChildTokenHash(
			db,
			submit.task_id,
			"sha256:3a6eb0790f39ac87c94f3856b2dd2c5d110e6811602261a9a923d3bb23adc8b7",
		);
		await runReportTaskEvent(ctx, {
			task_id: submit.task_id,
			child_token: "data",
			type: "completed",
			message: "Done",
		});

		const ack = await runDeleteTasks(ctx, { task_ids: [submit.task_id] });

		expect(ack.ok).toBe(true);
		expect(getTaskById(db, submit.task_id)).toBeNull();
		expect(listTaskEvents(db, submit.task_id)).toEqual([]);
	});

	it("refuses to delete a running task (caller must cancel first)", async () => {
		const submit = await runSubmitTask(ctx, {
			objective: "x",
			agent_kind: "claude-code",
			cwd: "/tmp",
		});
		if (!submit.accepted) throw new Error("setup failed");
		const ack = await runDeleteTasks(ctx, { task_ids: [submit.task_id] });
		expect(ack.ok).toBe(false);
		if (!ack.ok) {
			expect(ack.error.code).toBe("invalid_state");
			expect(ack.error.message).toMatch(/cancel it before deleting/);
		}
		// Row still present — the refuse did not accidentally succeed.
		expect(getTaskById(db, submit.task_id)).not.toBeNull();
	});

	it("kills the orphaned tmux session when a child-reported terminal task is deleted", async () => {
		// Regression for cuekit-delete-session-tmux-leak: report_task_event(completed)
		// updates DB status but does NOT kill the tmux session. delete_task must
		// clean up the orphaned pane so operators don't have to do it manually.
		const submit = await runSubmitTask(ctx, {
			objective: "x",
			agent_kind: "claude-code",
			cwd: "/tmp",
		});
		if (!submit.accepted) throw new Error("setup failed");
		updateTaskChildTokenHash(
			db,
			submit.task_id,
			"sha256:3a6eb0790f39ac87c94f3856b2dd2c5d110e6811602261a9a923d3bb23adc8b7",
		);
		// report_task_event transitions task to terminal but leaves tmux session alive
		await runReportTaskEvent(ctx, {
			task_id: submit.task_id,
			child_token: "data",
			type: "completed",
			message: "Done",
		});

		const sessionName = `cuekit-task-${submit.task_id}`;
		expect(runner.knownSessions()).toContain(sessionName);

		const ack = await runDeleteTasks(ctx, { task_ids: [submit.task_id] });
		expect(ack.ok).toBe(true);
		expect(runner.knownSessions()).not.toContain(sessionName);
	});

	it("returns task_not_found for unknown id", async () => {
		const ack = await runDeleteTasks(ctx, { task_ids: ["t_nope"] });
		expect(ack.ok).toBe(false);
		if (!ack.ok) expect(ack.error.code).toBe("task_not_found");
	});

	it("deletes multiple terminal tasks in one call", async () => {
		const a = await runSubmitTask(ctx, { objective: "a", agent_kind: "claude-code", cwd: "/tmp" });
		const b = await runSubmitTask(ctx, { objective: "b", agent_kind: "claude-code", cwd: "/tmp" });
		if (!a.accepted || !b.accepted) throw new Error("setup failed");
		await runCancelTasks(ctx, { task_ids: [a.task_id, b.task_id] });

		const ack = await runDeleteTasks(ctx, { task_ids: [a.task_id, b.task_id] });

		expect(ack.ok).toBe(true);
		expect(ack.tasks).toHaveLength(2);
		expect(getTaskById(db, a.task_id)).toBeNull();
		expect(getTaskById(db, b.task_id)).toBeNull();
	});

	it("rejects duplicate task ids", async () => {
		const ack = await runDeleteTasks(ctx, { task_ids: ["t_same", "t_same"] });
		expect(ack.ok).toBe(false);
		if (!ack.ok) expect(ack.error.code).toBe("invalid_input");
	});
});

describe("cleanup-tasks", () => {
	it("deletes terminal tasks in a session without deleting the session", async () => {
		const a = await runSubmitTask(ctx, { objective: "a", agent_kind: "claude-code", cwd: "/tmp" });
		const b = await runSubmitTask(ctx, { objective: "b", agent_kind: "claude-code", cwd: "/tmp" });
		if (!a.accepted || !b.accepted) throw new Error("setup failed");
		await runCancelTasks(ctx, { task_ids: [a.task_id, b.task_id] });

		const ack = await runCleanupTasks(ctx, { session_id: a.session_id });

		expect(ack.ok).toBe(true);
		if (ack.ok) {
			expect(ack.tasks.map((task) => task.task_id).sort()).toEqual([a.task_id, b.task_id].sort());
			expect(ack.tasks.every((task) => task.deleted)).toBe(true);
		}
		expect(getSessionById(db, a.session_id)).not.toBeNull();
		expect(getTaskById(db, a.task_id)).toBeNull();
		expect(getTaskById(db, b.task_id)).toBeNull();
	});

	it("supports dry-run cleanup", async () => {
		const submit = await runSubmitTask(ctx, {
			objective: "x",
			agent_kind: "claude-code",
			cwd: "/tmp",
		});
		if (!submit.accepted) throw new Error("setup failed");
		await runCancelTasks(ctx, { task_ids: [submit.task_id] });

		const ack = await runCleanupTasks(ctx, { session_id: submit.session_id, dry_run: true });

		expect(ack.ok).toBe(true);
		if (ack.ok) expect(ack.tasks[0]?.deleted).toBe(false);
		expect(getTaskById(db, submit.task_id)).not.toBeNull();
	});

	it("requires exactly one cleanup scope", async () => {
		const noScope = await runCleanupTasks(ctx, {});
		expect(noScope.ok).toBe(false);
		if (!noScope.ok) expect(noScope.error.code).toBe("invalid_input");

		const twoScopes = await runCleanupTasks(ctx, { session_id: "s", cwd: "/tmp" });
		expect(twoScopes.ok).toBe(false);
		if (!twoScopes.ok) expect(twoScopes.error.code).toBe("invalid_input");
	});
});

describe("delete-sessions", () => {
	it("deletes a session whose tasks are all terminal, cascading to children", async () => {
		const submit = await runSubmitTask(ctx, {
			objective: "x",
			agent_kind: "claude-code",
			cwd: "/tmp",
		});
		if (!submit.accepted) throw new Error("setup failed");
		await runCancelTasks(ctx, { task_ids: [submit.task_id] });
		const ack = await runDeleteSessions(ctx, { session_ids: [submit.session_id] });
		expect(ack.ok).toBe(true);
		expect(getSessionById(db, submit.session_id)).toBeNull();
		expect(getTaskById(db, submit.task_id)).toBeNull();
	});

	it("deletes a session whose terminal tasks have child report events", async () => {
		const submit = await runSubmitTask(ctx, {
			objective: "x",
			agent_kind: "claude-code",
			cwd: "/tmp",
		});
		if (!submit.accepted) throw new Error("setup failed");
		updateTaskChildTokenHash(
			db,
			submit.task_id,
			"sha256:3a6eb0790f39ac87c94f3856b2dd2c5d110e6811602261a9a923d3bb23adc8b7",
		);
		await runReportTaskEvent(ctx, {
			task_id: submit.task_id,
			child_token: "data",
			type: "completed",
			message: "Done",
		});

		const ack = await runDeleteSessions(ctx, { session_ids: [submit.session_id] });

		expect(ack.ok).toBe(true);
		expect(getSessionById(db, submit.session_id)).toBeNull();
		expect(getTaskById(db, submit.task_id)).toBeNull();
		expect(listTaskEvents(db, submit.task_id)).toEqual([]);
	});

	it("deletes an empty session (no tasks) — valid terminal state", async () => {
		createSession(db, {
			id: "s_empty",
			project_root: "/p",
			worktree_path: "/w",
			parent_agent_kind: "pi",
		});
		const ack = await runDeleteSessions(ctx, { session_ids: ["s_empty"] });
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
		const ack = await runDeleteSessions(ctx, { session_ids: [submit.session_id] });
		expect(ack.ok).toBe(false);
		if (!ack.ok) {
			expect(ack.error.code).toBe("invalid_state");
			expect(ack.error.message).toMatch(/active task/);
		}
		// Both rows still present — block is complete, not partial.
		expect(getSessionById(db, submit.session_id)).not.toBeNull();
		expect(getTaskById(db, submit.task_id)).not.toBeNull();
	});

	it("kills orphaned tmux sessions for all child-reported terminal tasks on session deletion", async () => {
		// Regression for cuekit-delete-session-tmux-leak: when multiple tasks
		// transition to terminal via report_task_event, none of their tmux sessions
		// are killed. delete_session must clean them all up.
		const a = await runSubmitTask(ctx, {
			objective: "a",
			agent_kind: "claude-code",
			cwd: "/tmp",
		});
		const b = await runSubmitTask(ctx, {
			objective: "b",
			agent_kind: "claude-code",
			cwd: "/tmp",
		});
		if (!a.accepted || !b.accepted) throw new Error("setup failed");
		expect(a.session_id).toBe(b.session_id);

		for (const task_id of [a.task_id, b.task_id]) {
			updateTaskChildTokenHash(
				db,
				task_id,
				"sha256:3a6eb0790f39ac87c94f3856b2dd2c5d110e6811602261a9a923d3bb23adc8b7",
			);
			await runReportTaskEvent(ctx, {
				task_id,
				child_token: "data",
				type: "completed",
				message: "Done",
			});
		}

		const sessionA = `cuekit-task-${a.task_id}`;
		const sessionB = `cuekit-task-${b.task_id}`;
		expect(runner.knownSessions()).toContain(sessionA);
		expect(runner.knownSessions()).toContain(sessionB);

		const ack = await runDeleteSessions(ctx, { session_ids: [a.session_id] });
		expect(ack.ok).toBe(true);
		expect(runner.knownSessions()).not.toContain(sessionA);
		expect(runner.knownSessions()).not.toContain(sessionB);
	});

	it("kills tmux sessions for child-reported completed tasks on session deletion", async () => {
		const submit = await runSubmitTask(ctx, {
			objective: "x",
			agent_kind: "claude-code",
			cwd: "/tmp",
		});
		if (!submit.accepted) throw new Error("setup failed");
		updateTaskChildTokenHash(
			db,
			submit.task_id,
			"sha256:3a6eb0790f39ac87c94f3856b2dd2c5d110e6811602261a9a923d3bb23adc8b7",
		);
		await runReportTaskEvent(ctx, {
			task_id: submit.task_id,
			child_token: "data",
			type: "completed",
			message: "Done",
		});

		const sessionName = `cuekit-task-${submit.task_id}`;
		expect(runner.knownSessions()).toContain(sessionName);

		const ack = await runDeleteSessions(ctx, { session_ids: [submit.session_id] });
		expect(ack.ok).toBe(true);
		expect(runner.knownSessions()).not.toContain(sessionName);
	});

	it("returns session_not_found for unknown id", async () => {
		const ack = await runDeleteSessions(ctx, { session_ids: ["s_nope"] });
		expect(ack.ok).toBe(false);
		if (!ack.ok) expect(ack.error.code).toBe("session_not_found");
	});

	it("deletes multiple sessions in one call", async () => {
		createSession(db, {
			id: "s_empty_a",
			project_root: "/p",
			worktree_path: "/w/a",
			parent_agent_kind: "pi",
		});
		createSession(db, {
			id: "s_empty_b",
			project_root: "/p",
			worktree_path: "/w/b",
			parent_agent_kind: "pi",
		});

		const ack = await runDeleteSessions(ctx, { session_ids: ["s_empty_a", "s_empty_b"] });

		expect(ack.ok).toBe(true);
		expect(ack.sessions).toHaveLength(2);
		expect(getSessionById(db, "s_empty_a")).toBeNull();
		expect(getSessionById(db, "s_empty_b")).toBeNull();
	});

	it("rejects duplicate session ids", async () => {
		const ack = await runDeleteSessions(ctx, { session_ids: ["s_same", "s_same"] });
		expect(ack.ok).toBe(false);
		if (!ack.ok) expect(ack.error.code).toBe("invalid_input");
	});
});
