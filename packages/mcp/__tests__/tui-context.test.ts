import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { AdapterRegistry } from "@cuekit/adapters";
import { createSession, createTask, runMigrations } from "@cuekit/store";
import { createTuiContext } from "../src/tui-context.ts";

function makeHarness() {
	const db = new Database(":memory:");
	db.exec("pragma foreign_keys = ON;");
	runMigrations(db);
	const registry = new AdapterRegistry();
	return { db, tui: createTuiContext({ db, registry }, { projectRoot: "/repo" }) };
}

describe("createTuiContext", () => {
	it("scopes task listing to the current repository cwd by default", async () => {
		const { db, tui } = makeHarness();
		createSession(db, {
			id: "s_repo",
			project_root: "/repo",
			worktree_path: "/repo/packages/mcp",
			parent_agent_kind: "pi",
		});
		createSession(db, {
			id: "s_other",
			project_root: "/other",
			worktree_path: "/other",
			parent_agent_kind: "pi",
		});
		createTask(db, {
			id: "t_repo",
			session_id: "s_repo",
			agent_kind: "claude-code",
			objective: "repo",
			status: "completed",
		});
		createTask(db, {
			id: "t_other",
			session_id: "s_other",
			agent_kind: "claude-code",
			objective: "other",
			status: "completed",
		});

		const result = await tui.listTasks({ limit: 100 });

		expect("tasks" in result).toBe(true);
		if ("tasks" in result) expect(result.tasks.map((task) => task.task_id)).toEqual(["t_repo"]);
	});

	it("can opt into global task listing", async () => {
		const db = new Database(":memory:");
		db.exec("pragma foreign_keys = ON;");
		runMigrations(db);
		const tui = createTuiContext(
			{ db, registry: new AdapterRegistry() },
			{ projectRoot: "/repo", all: true },
		);
		for (const [sessionId, worktree] of [
			["s_repo", "/repo"],
			["s_other", "/other"],
		] as const) {
			createSession(db, {
				id: sessionId,
				project_root: worktree,
				worktree_path: worktree,
				parent_agent_kind: "pi",
			});
			createTask(db, {
				id: `t_${sessionId}`,
				session_id: sessionId,
				agent_kind: "claude-code",
				objective: sessionId,
				status: "completed",
			});
		}

		const result = await tui.listTasks({ limit: 100 });

		expect("tasks" in result).toBe(true);
		if ("tasks" in result) expect(result.tasks).toHaveLength(2);
	});
});
