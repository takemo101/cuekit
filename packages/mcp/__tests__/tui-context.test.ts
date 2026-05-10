import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { AdapterRegistry, type MultiplexerBackend } from "@cuekit/adapters";
import {
	createSession,
	createTask,
	createTaskTeam,
	getTaskById,
	getTaskTeamById,
	runMigrations,
} from "@cuekit/store";
import { createTuiContext } from "../src/tui-context.ts";

function makeHarness(panes?: MultiplexerBackend) {
	const db = new Database(":memory:");
	db.exec("pragma foreign_keys = ON;");
	runMigrations(db);
	const registry = new AdapterRegistry();
	return { db, tui: createTuiContext({ db, registry, panes }, { projectRoot: "/repo" }) };
}

function fakePanes(overrides: Partial<MultiplexerBackend>): MultiplexerBackend {
	return {
		kind: "fake",
		sessionNameFor: (taskId: string) => `fake-${taskId}`,
		spawnPane: async () => {
			throw new Error("not implemented");
		},
		isAlive: async () => true,
		sendKeys: async () => {},
		capturePane: async () => null,
		killPane: async () => {},
		attachCommand: () => null,
		...overrides,
	};
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

	it("scopes team listing to the current repository cwd by default", async () => {
		const { db, tui } = makeHarness();
		createSession(db, {
			id: "s_repo_team",
			project_root: "/repo",
			worktree_path: "/repo",
			parent_agent_kind: "pi",
		});
		createSession(db, {
			id: "s_other_team",
			project_root: "/other",
			worktree_path: "/other",
			parent_agent_kind: "pi",
		});
		createTaskTeam(db, { id: "tm_repo", session_id: "s_repo_team", title: "Repo team" });
		createTaskTeam(db, { id: "tm_other", session_id: "s_other_team", title: "Other team" });

		const result = await tui.listTeams({ limit: 100 });

		expect("teams" in result).toBe(true);
		if ("teams" in result) expect(result.teams.map((team) => team.team_id)).toEqual(["tm_repo"]);
	});

	it("uses config project scope when listing teams", async () => {
		const db = new Database(":memory:");
		db.exec("pragma foreign_keys = ON;");
		runMigrations(db);
		const tui = createTuiContext(
			{ db, registry: new AdapterRegistry() },
			{ projectScope: { project_uid: "pc_current", project_root: "/repo" } },
		);
		createSession(db, {
			id: "s_current_team",
			project_root: "/repo-copy",
			worktree_path: "/repo-copy/worktree",
			parent_agent_kind: "pi",
			project_uid: "pc_current",
		});
		createSession(db, {
			id: "s_legacy_team",
			project_root: "/repo",
			worktree_path: "/elsewhere/repo",
			parent_agent_kind: "pi",
		});
		createSession(db, {
			id: "s_other_team",
			project_root: "/other",
			worktree_path: "/repo",
			parent_agent_kind: "pi",
			project_uid: "pc_other",
		});
		createTaskTeam(db, { id: "tm_current", session_id: "s_current_team", title: "Current" });
		createTaskTeam(db, { id: "tm_legacy", session_id: "s_legacy_team", title: "Legacy" });
		createTaskTeam(db, { id: "tm_other", session_id: "s_other_team", title: "Other" });

		const result = await tui.listTeams({ limit: 100 });

		expect("teams" in result).toBe(true);
		if ("teams" in result) {
			expect(result.teams.map((team) => team.team_id).sort()).toEqual(["tm_current", "tm_legacy"]);
		}
	});

	it("exposes cleanup and delete team actions for the TUI", async () => {
		const { db, tui } = makeHarness();
		createSession(db, {
			id: "s_cleanup_team",
			project_root: "/repo",
			worktree_path: "/repo",
			parent_agent_kind: "pi",
		});
		createTaskTeam(db, { id: "tm_cleanup", session_id: "s_cleanup_team", title: "Cleanup" });
		createTask(db, {
			id: "t_cleanup",
			session_id: "s_cleanup_team",
			agent_kind: "claude-code",
			team_id: "tm_cleanup",
			objective: "done",
			status: "completed",
		});
		createTask(db, {
			id: "t_keep_running",
			session_id: "s_cleanup_team",
			agent_kind: "claude-code",
			team_id: "tm_cleanup",
			objective: "running",
			status: "running",
		});

		const cleanup = await tui.cleanupTeam("tm_cleanup");
		expect(cleanup.ok).toBe(true);
		expect(getTaskById(db, "t_cleanup")).toBeNull();
		expect(getTaskById(db, "t_keep_running")?.status).toBe("running");

		const notEmptyDelete = await tui.deleteTeam("tm_cleanup");
		expect(notEmptyDelete.ok).toBe(false);
		if (!notEmptyDelete.ok) expect(notEmptyDelete.error.code).toBe("invalid_state");
	});

	it("kills the backend team session when cleanup removes the last member", async () => {
		const killedTeams: string[] = [];
		const { db, tui } = makeHarness(
			fakePanes({
				killTeamSession: async (teamId: string) => {
					killedTeams.push(teamId);
				},
			}),
		);
		createSession(db, {
			id: "s_cleanup_last",
			project_root: "/repo",
			worktree_path: "/repo",
			parent_agent_kind: "pi",
		});
		createTaskTeam(db, { id: "tm_cleanup_last", session_id: "s_cleanup_last", title: "Cleanup" });
		createTask(db, {
			id: "t_cleanup_last",
			session_id: "s_cleanup_last",
			agent_kind: "claude-code",
			team_id: "tm_cleanup_last",
			objective: "done",
			status: "completed",
		});

		const cleanup = await tui.cleanupTeam("tm_cleanup_last");

		expect(cleanup.ok).toBe(true);
		expect(getTaskById(db, "t_cleanup_last")).toBeNull();
		expect(killedTeams).toEqual(["tm_cleanup_last"]);
	});

	it("returns TUI ack errors for unknown team actions", async () => {
		const { tui } = makeHarness();

		const cleanup = await tui.cleanupTeam("tm_missing");
		expect(cleanup.ok).toBe(false);
		if (!cleanup.ok) expect(cleanup.error.code).toBe("team_not_found");

		const deleted = await tui.deleteTeam("tm_missing");
		expect(deleted.ok).toBe(false);
		if (!deleted.ok) expect(deleted.error.code).toBe("team_not_found");
	});

	it("deletes empty teams through the TUI context", async () => {
		const { db, tui } = makeHarness();
		createSession(db, {
			id: "s_delete_team",
			project_root: "/repo",
			worktree_path: "/repo",
			parent_agent_kind: "pi",
		});
		createTaskTeam(db, { id: "tm_delete", session_id: "s_delete_team", title: "Delete" });

		const deleted = await tui.deleteTeam("tm_delete");
		expect(deleted.ok).toBe(true);
		expect(getTaskTeamById(db, "tm_delete")).toBeNull();
	});
});
