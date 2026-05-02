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

	it("uses config project scope with legacy project_root fallback", async () => {
		const db = new Database(":memory:");
		db.exec("pragma foreign_keys = ON;");
		runMigrations(db);
		const tui = createTuiContext(
			{ db, registry: new AdapterRegistry() },
			{ projectScope: { project_uid: "pc_current", project_root: "/repo" } },
		);
		createSession(db, {
			id: "s_current",
			project_root: "/repo-copy",
			worktree_path: "/repo-copy",
			parent_agent_kind: "pi",
			project_uid: "pc_current",
		});
		createSession(db, {
			id: "s_legacy",
			project_root: "/repo",
			worktree_path: "/repo",
			parent_agent_kind: "pi",
		});
		createSession(db, {
			id: "s_other",
			project_root: "/other",
			worktree_path: "/other",
			parent_agent_kind: "pi",
			project_uid: "pc_other",
		});
		for (const session of ["s_current", "s_legacy", "s_other"] as const) {
			createTask(db, {
				id: `t_${session}`,
				session_id: session,
				agent_kind: "claude-code",
				objective: session,
				status: "completed",
			});
		}

		const result = await tui.listTasks({ limit: 100 });

		expect("tasks" in result).toBe(true);
		if ("tasks" in result) {
			expect(result.tasks.map((task) => task.task_id).sort()).toEqual([
				"t_s_current",
				"t_s_legacy",
			]);
		}
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
