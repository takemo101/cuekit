import { describe, expect, test } from "bun:test";
import { HookDispatcher } from "../src/hook-dispatcher.ts";

describe("HookDispatcher", () => {
	test("fire runs command asynchronously with env vars", async () => {
		const hooks = new HookDispatcher(
			{
				on_task_complete: { command: "echo $CUEKIT_TASK_ID > /tmp/cuekit-hook-test.txt" },
			},
			undefined,
		);

		hooks.fire("on_task_complete", {
			CUEKIT_EVENT: "on_task_complete",
			CUEKIT_TASK_ID: "t_test123",
			CUEKIT_STATUS: "completed",
			CUEKIT_AGENT_KIND: "pi",
			CUEKIT_SESSION_ID: "s_1",
		});

		// Wait for async spawn
		await Bun.sleep(500);

		const content = await Bun.file("/tmp/cuekit-hook-test.txt").text();
		expect(content.trim()).toBe("t_test123");
	});

	test("fire is no-op when event is not configured", () => {
		const hooks = new HookDispatcher({}, undefined);
		// Should not throw
		hooks.fire("on_task_complete", { CUEKIT_EVENT: "on_task_complete", CUEKIT_TASK_ID: "t_1" });
	});

	test("taskEnv builds env from task", () => {
		const task = {
			id: "t_abc",
			session_id: "s_1",
			agent_kind: "claude-code",
			model: "sonnet",
			objective: "fix bug",
			status: "completed" as const,
			team_id: "tm_1",
			team_position: "coordinator" as const,
			spec_json: JSON.stringify({ strategy: "bugfix" }),
			created_at: "2026-01-01T00:00:00Z",
			updated_at: "2026-01-01T00:01:00Z",
			started_at: "2026-01-01T00:00:00Z",
			completed_at: null,
			parent_task_id: null,
			role: null,
			role_source: null,
			role_selection_reason: null,
			native_task_ref: null,
			child_token_hash: null,
			summary: null,
			result_ref: null,
			transcript_ref: null,
		};

		const env = HookDispatcher.taskEnv(task);

		expect(env.CUEKIT_TASK_ID).toBe("t_abc");
		expect(env.CUEKIT_STATUS).toBe("completed");
		expect(env.CUEKIT_AGENT_KIND).toBe("claude-code");
		expect(env.CUEKIT_AGENT_MODEL).toBe("sonnet");
		expect(env.CUEKIT_OBJECTIVE).toBe("fix bug");
		expect(env.CUEKIT_TEAM_ID).toBe("tm_1");
		expect(env.CUEKIT_POSITION).toBe("coordinator");
		expect(env.CUEKIT_STRATEGY).toBe("bugfix");
		expect(env.CUEKIT_DURATION_MS).toBe("60000");
	});

	test("fire expands env vars inside single-quoted strings", async () => {
		const hooks = new HookDispatcher(
			{
				on_task_complete: {
					command: "echo '$CUEKIT_TASK_ID' > /tmp/cuekit-hook-quoted-test.txt",
				},
			},
			undefined,
		);

		hooks.fire("on_task_complete", {
			CUEKIT_EVENT: "on_task_complete",
			CUEKIT_TASK_ID: "t_quoted456",
			CUEKIT_STATUS: "completed",
			CUEKIT_AGENT_KIND: "pi",
			CUEKIT_SESSION_ID: "s_1",
		});

		await Bun.sleep(500);

		const content = await Bun.file("/tmp/cuekit-hook-quoted-test.txt").text();
		expect(content.trim()).toBe("t_quoted456");
	});
});
