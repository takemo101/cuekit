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
	FakeTmuxRunner,
	PaneBackend,
} from "@cuekit/adapters";
import { getTaskById, runMigrations } from "@cuekit/store";
import { createCli } from "../src/cli.ts";
import type { CommandContext } from "../src/command-context.ts";
import { runCancelTask } from "../src/commands/cancel-task.ts";
import { runGetTaskResult } from "../src/commands/get-task-result.ts";
import { runGetTaskStatus } from "../src/commands/get-task-status.ts";
import { runSubmitTask } from "../src/commands/submit-task.ts";

// Full delegation flow: submit → status → cancel → get-task-result.
// Validates the wiring from MCP commands through the adapter (pane spawn,
// native_task_ref capture, transcript path creation) down to the store.

let tmpRoot: string;
let db: Database;
let ctx: CommandContext;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "cuekit-e2e-"));
	db = new Database(":memory:");
	db.exec("pragma foreign_keys = ON;");
	runMigrations(db);
	const panes = new PaneBackend({
		runner: new FakeTmuxRunner(),
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
		expect(early.ok).toBe(false);
		if (!early.ok) {
			expect(early.error.code).toBe("invalid_state");
		}

		// 6. cancel
		const ack = await runCancelTask(ctx, { task_id });
		expect(ack.ok).toBe(true);

		// 7. collect after cancel → TaskResult with transcript artifact
		const collected = await runGetTaskResult(ctx, { task_id });
		expect(collected.ok).toBe(true);
		if (collected.ok) {
			expect(collected.value.status).toBe("cancelled");
			expect(collected.value.artifacts.length).toBeGreaterThan(0);
			const transcript = collected.value.artifacts.find(
				(a: { kind: string }) => a.kind === "transcript",
			);
			expect(transcript).toBeDefined();
			expect(transcript?.ref).toContain(".cuekit/tasks/");
		}
	});

	it("delivers the same flow through cli.fetch", async () => {
		const cli = createCli(ctx);

		const submitRes = await cli.fetch(
			new Request("http://localhost/submit-task", {
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
			new Request(`http://localhost/get-task-status?task_id=${task_id}`),
		);
		const statusBody = (await statusRes.json()) as {
			data: { status: string; attach_hint?: string };
		};
		expect(statusBody.data.status).toBe("running");
		expect(statusBody.data.attach_hint).toContain(task_id);

		const listRes = await cli.fetch(new Request("http://localhost/list-tasks"));
		const listBody = (await listRes.json()) as {
			data: { tasks: Array<{ task_id: string }> };
		};
		expect(listBody.data.tasks.some((t) => t.task_id === task_id)).toBe(true);
	});

	it("list-adapters surfaces all three MVP adapters with correct model capabilities", async () => {
		const cli = createCli(ctx);
		const res = await cli.fetch(new Request("http://localhost/list-adapters"));
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
		// pi: no model selection
		expect(map.get("pi")?.supports_model_selection).toBe(false);
		// opencode: model selection but runtime-configurable catalog (no list)
		expect(map.get("opencode")?.supports_model_selection).toBe(true);
		expect(map.get("opencode")?.available_models).toBeUndefined();
	});
});
