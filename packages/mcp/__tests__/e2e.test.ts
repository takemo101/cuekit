import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	AdapterRegistry,
	createClaudeCodeAdapter,
	createOpenCodeAdapter,
	createPiAdapter,
	TmuxBackend,
} from "@cuekit/adapters";
import { FakeTmuxRunner } from "@cuekit/adapters/testing";
import { getTaskById, runMigrations } from "@cuekit/store";
import { createCli } from "../src/cli.ts";
import type { CommandContext } from "../src/command-context.ts";
import { runCancelTasks } from "../src/commands/cancel-task.ts";
import { runGetTaskResult } from "../src/commands/get-task-result.ts";
import { runGetTaskStatus } from "../src/commands/get-task-status.ts";
import { runListTaskEvents } from "../src/commands/list-task-events.ts";
import { runReportTaskEvent } from "../src/commands/report-task-event.ts";
import { runSubmitTask } from "../src/commands/submit-task.ts";

// Full delegation flow: submit → status → cancel → get-task-result.
// Validates the wiring from MCP commands through the adapter (pane spawn,
// native_task_ref capture, transcript path creation) down to the store.

let tmpRoot: string;
let db: Database;
let runner: FakeTmuxRunner;
let ctx: CommandContext;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "cuekit-e2e-"));
	db = new Database(":memory:");
	db.exec("pragma foreign_keys = ON;");
	runMigrations(db);
	runner = new FakeTmuxRunner();
	const panes = new TmuxBackend({
		runner,
		sendKeysDelayMs: 0,
	});
	const registry = new AdapterRegistry();
	registry.register(
		createClaudeCodeAdapter(db, panes, { launchCommandOverride: () => "sleep 60" }),
	);
	registry.register(createPiAdapter(db, panes, { launchCommandOverride: () => "sleep 60" }));
	registry.register(createOpenCodeAdapter(db, panes, { launchCommandOverride: () => "sleep 60" }));
	ctx = { db, registry };
});

afterEach(() => {
	rmSync(tmpRoot, { recursive: true, force: true });
});

describe("e2e: submit → status → cancel → result", () => {
	function childTokenFor(task_id: string): string {
		const newSession = runner.calls.find(
			(call) => call[0] === "new-session" && call.includes(`CUEKIT_TASK_ID=${task_id}`),
		);
		const tokenArg = newSession?.find((arg) => arg.startsWith("CUEKIT_CHILD_TOKEN="));
		const token = tokenArg?.slice("CUEKIT_CHILD_TOKEN=".length);
		if (!token) throw new Error(`missing child token for ${task_id}`);
		return token;
	}

	it("completes the minimal delegation flow end-to-end", async () => {
		// 1. submit
		const submit = await runSubmitTask(ctx, {
			objective: "Add retry logic to the API client",
			agent_kind: "claude-code",
			cwd: tmpRoot,
			model: "sonnet",
		});
		expect(submit.accepted).toBe(true);
		if (!submit.accepted) throw new Error("submit failed");
		const task_id = submit.task_id;

		// 2. verify task row + transcript path were set up
		const row = getTaskById(db, task_id);
		expect(row?.status).toBe("running");
		expect(row?.model).toBe("sonnet");
		expect(row?.native_task_ref).toMatch(/^%\d+$/);
		expect(row?.transcript_ref).toBe(join(tmpRoot, ".cuekit", "tasks", task_id, "transcript.txt"));
		// 3. verify the per-task output directory was created on disk
		expect(existsSync(join(tmpRoot, ".cuekit", "tasks", task_id))).toBe(true);

		// 4. status: running + attach_hint
		const status = await runGetTaskStatus(ctx, { task_id });
		expect(status.status).toBe("running");
		expect(status.attach_hint).toContain(`cuekit-task-${task_id}`);

		// 5. collect attempt on running task → invalid_state
		const early = await runGetTaskResult(ctx, { task_id });
		expect("task_id" in early).toBe(false);
		if (!("task_id" in early)) {
			expect(early.error.code).toBe("invalid_state");
		}

		// 6. cancel
		const ack = await runCancelTasks(ctx, { task_ids: [task_id] });
		expect(ack.ok).toBe(true);

		// 7. collect after cancel → TaskResult with transcript artifact
		const collected = await runGetTaskResult(ctx, { task_id });
		expect("task_id" in collected).toBe(true);
		if ("task_id" in collected) {
			expect(collected.status).toBe("cancelled");
			expect(collected.artifacts.length).toBeGreaterThan(0);
			const transcript = collected.artifacts.find((a: { kind: string }) => a.kind === "transcript");
			expect(transcript).toBeDefined();
			expect(transcript?.ref).toContain(".cuekit/tasks/");
		}
	});

	it("passes the parent database path to child processes for CLI reporting fallback", async () => {
		const dbPath = join(tmpRoot, "state.db");
		const fileDb = new Database(dbPath);
		fileDb.exec("pragma foreign_keys = ON;");
		runMigrations(fileDb);
		try {
			const localRunner = new FakeTmuxRunner();
			const localPanes = new TmuxBackend({ runner: localRunner, sendKeysDelayMs: 0 });
			const localRegistry = new AdapterRegistry();
			localRegistry.register(
				createClaudeCodeAdapter(fileDb, localPanes, { launchCommandOverride: () => "sleep 60" }),
			);
			const localCtx = { db: fileDb, registry: localRegistry };

			const submit = await runSubmitTask(localCtx, {
				objective: "report through fallback cli",
				agent_kind: "claude-code",
				cwd: tmpRoot,
			});

			expect(submit.accepted).toBe(true);
			if (!submit.accepted) return;
			const newSession = localRunner.calls.find(
				(call) => call[0] === "new-session" && call.includes(`CUEKIT_TASK_ID=${submit.task_id}`),
			);
			expect(newSession).toContain(`CUEKIT_DB_PATH=${dbPath}`);
		} finally {
			fileDb.close();
		}
	});

	it("covers simplified child reporting: submit env → report progress/completed → list events", async () => {
		const submit = await runSubmitTask(ctx, {
			objective: "report progress",
			agent_kind: "claude-code",
			cwd: tmpRoot,
		});
		expect(submit.accepted).toBe(true);
		if (!submit.accepted) throw new Error("submit failed");
		const task_id = submit.task_id;
		const child_token = childTokenFor(task_id);
		expect(child_token).not.toBe("");

		const progress = await runReportTaskEvent(ctx, {
			task_id,
			child_token,
			type: "progress",
			message: "Running tests",
		});
		expect(progress.ok).toBe(true);
		expect(getTaskById(db, task_id)?.status).toBe("running");

		const completed = await runReportTaskEvent(ctx, {
			task_id,
			child_token,
			type: "completed",
			message: "Implemented feature",
		});
		expect(completed.ok).toBe(true);
		// Completion is child-declared through the report API; it does not wait
		// for pane/process exit. Fake tmux still knows the session is alive here.
		const adapter = ctx.registry.require("claude-code");
		if (!adapter.ok) throw new Error("missing claude-code adapter");
		expect(await adapter.value.status(task_id)).toMatchObject({
			status: "completed",
		});
		expect(runner.knownSessions()).toContain(`cuekit-task-${task_id}`);

		const listed = await runListTaskEvents(ctx, { task_id });
		expect("events" in listed).toBe(true);
		if ("events" in listed) {
			expect(listed.events.map((event) => event.type)).toEqual(["progress", "completed"]);
		}
	});

	it("delivers the same flow through cli.fetch", async () => {
		const cli = createCli(ctx);

		const submitRes = await cli.fetch(
			new Request("http://localhost/task/submit", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					objective: "test via fetch",
					agent_kind: "claude-code",
					cwd: tmpRoot,
				}),
			}),
		);
		expect(submitRes.ok).toBe(true);
		const submitBody = (await submitRes.json()) as {
			ok: boolean;
			data: { accepted: boolean; task_id?: string };
		};
		expect(submitBody.ok).toBe(true);
		expect(submitBody.data.accepted).toBe(true);
		const task_id = submitBody.data.task_id;
		if (!task_id) throw new Error("no task_id");

		const statusRes = await cli.fetch(
			new Request(`http://localhost/task/status?task_id=${task_id}`),
		);
		const statusBody = (await statusRes.json()) as {
			data: { status: string; attach_hint?: string };
		};
		expect(statusBody.data.status).toBe("running");
		expect(statusBody.data.attach_hint).toContain(task_id);

		const listRes = await cli.fetch(new Request("http://localhost/task/list"));
		const listBody = (await listRes.json()) as {
			data: { tasks: Array<{ task_id: string }> };
		};
		expect(listBody.data.tasks.some((t) => t.task_id === task_id)).toBe(true);
	});

	it("reports and lists child events through cli.fetch", async () => {
		const cli = createCli(ctx);
		const submit = await runSubmitTask(ctx, {
			objective: "report through cli",
			agent_kind: "claude-code",
			cwd: tmpRoot,
		});
		if (!submit.accepted) throw new Error("submit failed");
		const task_id = submit.task_id;
		const previousTaskId = process.env.CUEKIT_TASK_ID;
		const previousToken = process.env.CUEKIT_CHILD_TOKEN;
		process.env.CUEKIT_TASK_ID = task_id;
		process.env.CUEKIT_CHILD_TOKEN = childTokenFor(task_id);
		try {
			const progressRes = await cli.fetch(
				new Request("http://localhost/tool/report?type=progress&message=Working"),
			);
			expect(progressRes.ok).toBe(true);
			const progressBody = (await progressRes.json()) as { data: { ok: boolean } };
			expect(progressBody.data.ok).toBe(true);

			const completedRes = await cli.fetch(
				new Request("http://localhost/tool/report?type=completed&message=Done"),
			);
			expect(completedRes.ok).toBe(true);
			const completedBody = (await completedRes.json()) as { data: { ok: boolean } };
			expect(completedBody.data.ok).toBe(true);

			const statusRes = await cli.fetch(
				new Request(`http://localhost/task/status?task_id=${task_id}`),
			);
			const statusBody = (await statusRes.json()) as { data: { status: string } };
			expect(statusBody.data.status).toBe("completed");

			const eventsRes = await cli.fetch(
				new Request(`http://localhost/task/events?task_id=${task_id}`),
			);
			expect(eventsRes.ok).toBe(true);
			const eventsBody = (await eventsRes.json()) as {
				data: { events: Array<{ type: string; message: string | null }> };
			};
			expect(eventsBody.data.events).toEqual([
				expect.objectContaining({ type: "progress", message: "Working" }),
				expect.objectContaining({ type: "completed", message: "Done" }),
			]);
		} finally {
			if (previousTaskId === undefined) delete process.env.CUEKIT_TASK_ID;
			else process.env.CUEKIT_TASK_ID = previousTaskId;
			if (previousToken === undefined) delete process.env.CUEKIT_CHILD_TOKEN;
			else process.env.CUEKIT_CHILD_TOKEN = previousToken;
		}
	});

	it("adapter list surfaces all three MVP adapters with correct model capabilities", async () => {
		const cli = createCli(ctx);
		const res = await cli.fetch(new Request("http://localhost/adapter/list"));
		const body = (await res.json()) as {
			data: {
				adapters: Array<{
					agent_kind: string;
					supports_model_selection: boolean;
					available_models?: string[];
				}>;
			};
		};
		const map = new Map(body.data.adapters.map((a) => [a.agent_kind, a]));
		expect(map.size).toBe(3);
		// claude-code: model selection with a published list
		expect(map.get("claude-code")?.supports_model_selection).toBe(true);
		expect(map.get("claude-code")?.available_models).toContain("sonnet");
		// pi: model selection through `pi --model`, with no fixed catalog
		expect(map.get("pi")?.supports_model_selection).toBe(true);
		expect(map.get("pi")?.available_models).toBeUndefined();
		// opencode: model selection but runtime-configurable catalog (no list)
		expect(map.get("opencode")?.supports_model_selection).toBe(true);
		expect(map.get("opencode")?.available_models).toBeUndefined();
	});
});
