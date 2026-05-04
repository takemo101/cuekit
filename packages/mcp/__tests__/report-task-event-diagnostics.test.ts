import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { AdapterRegistry } from "@cuekit/adapters";
import { runMigrations } from "@cuekit/store";
import type { CommandContext } from "../src/command-context.ts";
import { runReportTaskEvent } from "../src/commands/report-task-event.ts";

describe("report-task-event diagnostics", () => {
	it("includes source and environment diagnostics when the task id is missing", async () => {
		const db = new Database(":memory:");
		runMigrations(db);
		const ctx: CommandContext = { db, registry: new AdapterRegistry() };
		const previousTaskId = process.env.CUEKIT_TASK_ID;
		const previousToken = process.env.CUEKIT_CHILD_TOKEN;
		process.env.CUEKIT_TASK_ID = "t_missing_from_env";
		process.env.CUEKIT_CHILD_TOKEN = "secret";
		try {
			const result = await runReportTaskEvent(ctx, {
				type: "completed",
				message: "done",
			});

			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.error.code).toBe("task_not_found");
			expect(result.error.details).toMatchObject({
				task_id: "t_missing_from_env",
				task_id_source: "env:CUEKIT_TASK_ID",
				child_token_source: "env:CUEKIT_CHILD_TOKEN",
				has_child_token: true,
				db_path: ":memory:",
			});
			expect(result.error.details?.cwd).toBe(process.cwd());
		} finally {
			if (previousTaskId === undefined) delete process.env.CUEKIT_TASK_ID;
			else process.env.CUEKIT_TASK_ID = previousTaskId;
			if (previousToken === undefined) delete process.env.CUEKIT_CHILD_TOKEN;
			else process.env.CUEKIT_CHILD_TOKEN = previousToken;
			db.close();
		}
	});
});
