import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import {
	AdapterRegistry,
	createClaudeCodeAdapter,
	createPiAdapter,
	TmuxBackend,
} from "@cuekit/adapters";
import { FakeTmuxRunner } from "@cuekit/adapters/testing";
import {
	appendTaskEvent,
	createSession,
	createTask,
	createTaskTeam,
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
import { runCleanupTeam } from "../src/commands/cleanup-team.ts";
import { runCreateTeam } from "../src/commands/create-team.ts";
import { runDeleteSessions } from "../src/commands/delete-session.ts";
import { runDeleteTasks } from "../src/commands/delete-task.ts";
import { runDeleteTeam } from "../src/commands/delete-team.ts";
import { runGetTaskResult } from "../src/commands/get-task-result.ts";
import { runGetTaskStatus } from "../src/commands/get-task-status.ts";
import { runGetTeamResult } from "../src/commands/get-team-result.ts";
import { runGetTeamStatus } from "../src/commands/get-team-status.ts";
import { runListAdapters } from "../src/commands/list-adapters.ts";
import { runListAgentProfiles } from "../src/commands/list-agent-profiles.ts";
import { ListStrategiesOutputSchema, runListStrategies } from "../src/commands/list-strategies.ts";
import { runListTaskEvents } from "../src/commands/list-task-events.ts";
import { runListTasks } from "../src/commands/list-tasks.ts";
import { runListTeams } from "../src/commands/list-teams.ts";
import { runReportTaskEvent } from "../src/commands/report-task-event.ts";
import { runShowMcpConfig } from "../src/commands/show-mcp-config.ts";
import { runStartTeamStrategy } from "../src/commands/start-team-strategy.ts";
import { runSteerTask, SteerTaskInputSchema } from "../src/commands/steer-task.ts";
import { runSteerTeam } from "../src/commands/steer-team.ts";
import { runSubmitTask } from "../src/commands/submit-task.ts";
import { runSubmitTeamTasks } from "../src/commands/submit-team-tasks.ts";
import { runWaitTasks } from "../src/commands/wait-tasks.ts";
import { runWaitTeam } from "../src/commands/wait-team.ts";
import {
	applyMcpWaitSafetyBounds,
	MCP_SAFE_WAIT_TIMEOUT_MS,
	CUEKIT_MCP_OPERATIONS,
} from "../src/operations.ts";

let db: Database;
let runner: FakeTmuxRunner;
let ctx: CommandContext;

beforeEach(() => {
	db = new Database(":memory:");
	db.exec("pragma foreign_keys = ON;");
	runMigrations(db);
	runner = new FakeTmuxRunner();
	const panes = new TmuxBackend({ runner, sendKeysDelayMs: 0 });
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
	ctx = { db, registry, panes };
});

describe("team commands", () => {
	it("create-team auto-creates a session from cwd", () => {
		const result = runCreateTeam(ctx, {
			title: "Implement teams",
			objective: "Coordinate related tasks",
			cwd: "/my/project",
		});

		expect("team_id" in result).toBe(true);
		if (!("team_id" in result)) return;
		expect(result.team_id).toMatch(/^tm_/);
		expect(result.session_id).toMatch(/^s_/);
		expect(result.title).toBe("Implement teams");
		expect(listSessionsByWorktree(db, "/my/project")).toHaveLength(1);
	});

	it("create-team rejects empty title", () => {
		const parsed = runCreateTeam(ctx, { title: "", cwd: "/my/project" });

		expect("error" in parsed).toBe(true);
		if ("error" in parsed) expect(parsed.error.code).toBe("invalid_input");
	});

	it("create-team returns session_not_found for an unknown explicit session", () => {
		const result = runCreateTeam(ctx, { title: "Team", session_id: "s_missing" });

		expect("error" in result).toBe(true);
		if ("error" in result) expect(result.error.code).toBe("session_not_found");
	});

	it("list-teams normalizes cwd filters", () => {
		const cwd = mkdtempSync(join(tmpdir(), "cuekit-team-cwd-"));
		try {
			const created = runCreateTeam(ctx, { title: "Team", cwd });
			if (!("team_id" in created)) throw new Error("setup failed");

			const listed = runListTeams(ctx, { cwd: relative(process.cwd(), cwd) });

			expect(listed.teams.map((team) => team.team_id)).toContain(created.team_id);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("list-teams filters by session and paginates", () => {
		createSession(db, {
			id: "s1",
			project_root: "/p",
			worktree_path: "/w",
			parent_agent_kind: "pi",
		});
		createTaskTeam(db, { id: "tm_1", session_id: "s1", title: "One" });
		createTaskTeam(db, { id: "tm_2", session_id: "s1", title: "Two" });

		const first = runListTeams(ctx, { session_id: "s1", limit: 1 });

		expect(first.teams).toHaveLength(1);
		expect(first.has_more).toBe(true);
		expect(first.next_cursor).toBeDefined();
		const second = runListTeams(ctx, { session_id: "s1", limit: 1, cursor: first.next_cursor });
		expect(second.teams).toHaveLength(1);
		expect(second.teams[0]?.team_id).not.toBe(first.teams[0]?.team_id);
	});

	it("get-team-status summarizes child reports by position", () => {
		createSession(db, {
			id: "s_summary",
			project_root: "/p",
			worktree_path: "/w",
			parent_agent_kind: "pi",
		});
		createTaskTeam(db, { id: "tm_summary", session_id: "s_summary", title: "Team" });
		createTask(db, {
			id: "t_coord",
			session_id: "s_summary",
			agent_kind: "claude-code",
			team_id: "tm_summary",
			team_position: "coordinator",
			objective: "coordinate",
			status: "completed",
		});
		createTask(db, {
			id: "t_review",
			session_id: "s_summary",
			agent_kind: "claude-code",
			team_id: "tm_summary",
			team_position: "reviewer",
			objective: "review",
			status: "running",
		});
		createTask(db, {
			id: "t_finisher",
			session_id: "s_summary",
			agent_kind: "claude-code",
			team_id: "tm_summary",
			team_position: "finisher",
			objective: "finish",
			status: "completed",
		});
		const longFinisherMessage = `PR merged and branch cleaned up ${"x".repeat(260)}`;
		appendTaskEvent(db, {
			id: "e_finisher_done",
			task_id: "t_finisher",
			type: "completed",
			message: longFinisherMessage,
		});
		appendTaskEvent(db, {
			id: "e_coord_done",
			task_id: "t_coord",
			type: "completed",
			message: "Coordinator integrated the finisher report",
		});
		appendTaskEvent(db, {
			id: "e_review_progress",
			task_id: "t_review",
			type: "progress",
			message: "Reviewer is checking schema risks",
		});
		appendTaskEvent(db, {
			id: "e_coord_files",
			task_id: "t_coord",
			type: "log",
			message: "Coordinator file report",
			payload: { files: { written: ["packages/mcp/src/team-run-summary.ts"] } },
		});
		appendTaskEvent(db, {
			id: "e_review_files",
			task_id: "t_review",
			type: "log",
			message: "Reviewer file report",
			payload: {
				files: { read: ["packages/mcp/src/team-run-summary.ts", "packages/core/src/team.ts"] },
				diagnostic: { kind: "timeout", message: "timed out after 100ms" },
			},
		});

		const result = runGetTeamStatus(ctx, { team_id: "tm_summary" });

		expect("team_id" in result).toBe(true);
		if (!("team_id" in result)) return;
		expect(result.run_summary.terminal_reports).toBe(2);
		expect(result.run_summary.latest_terminal_message).toBe(
			"Coordinator integrated the finisher report",
		);
		expect(result.run_summary.positions.coordinator[0]?.message).toBe(
			"Coordinator integrated the finisher report",
		);
		expect(result.run_summary.positions.reviewer[0]?.message).toBe(
			"Reviewer is checking schema risks",
		);
		expect(result.run_summary.positions.finisher[0]?.message).toHaveLength(240);
		expect(result.run_summary.positions.finisher[0]?.message).toEndWith("…");
		expect(result.run_summary.attention_items?.map((item) => item.position)).toEqual(["finisher"]);
		expect(result.run_summary.attention_items?.[0]?.message).toHaveLength(240);
		expect(result.run_summary.attention_items?.[0]?.message).toEndWith("…");
		expect(result.run_summary.attention_items?.[0]?.message).toBe(
			result.run_summary.positions.finisher[0]?.message,
		);
		expect(
			result.run_summary.attention_items?.some((item) => item.position === "coordinator"),
		).toBe(false);
		expect(result.run_summary.open_attention?.[0]?.task_id).toBe("t_review");
		expect(result.run_summary.observability).toEqual({
			files_read: ["packages/mcp/src/team-run-summary.ts", "packages/core/src/team.ts"],
			files_written: ["packages/mcp/src/team-run-summary.ts"],
			diagnostics: [{ task_id: "t_review", kind: "timeout", message: "timed out after 100ms" }],
			warnings: [
				{
					kind: "stale_read",
					message:
						"Some tasks read files that were also written by team tasks; re-read may be needed.",
					paths: ["packages/mcp/src/team-run-summary.ts"],
				},
			],
		});
	});

	it("get-team-status team run summaries prefer durable events over transcript noise", () => {
		const root = mkdtempSync(join(tmpdir(), "cuekit-team-summary-events-"));
		try {
			const transcriptPath = join(root, "transcript.txt");
			writeFileSync(
				transcriptPath,
				"\u001b[2J\u001b[HOpenTUI repaint noise\nassistant> partial noisy transcript tail\n",
			);
			createSession(db, {
				id: "s_event_first_summary",
				project_root: root,
				worktree_path: root,
				parent_agent_kind: "pi",
			});
			createTaskTeam(db, {
				id: "tm_event_first_summary",
				session_id: "s_event_first_summary",
				title: "Team",
			});
			createTask(db, {
				id: "t_event_first_summary",
				session_id: "s_event_first_summary",
				agent_kind: "pi",
				team_id: "tm_event_first_summary",
				team_position: "coordinator",
				objective: "coordinate",
				status: "completed",
			});
			db.query("update tasks set transcript_ref = ?, summary = ? where id = ?").run(
				transcriptPath,
				"noisy summary fallback",
				"t_event_first_summary",
			);
			appendTaskEvent(db, {
				id: "e_event_first_summary",
				task_id: "t_event_first_summary",
				type: "completed",
				message: "Durable coordinator final report",
			});

			const result = runGetTeamStatus(ctx, { team_id: "tm_event_first_summary" });

			expect("team_id" in result).toBe(true);
			if (!("team_id" in result)) return;
			expect(result.run_summary.latest_terminal_message).toBe("Durable coordinator final report");
			expect(result.run_summary.positions.coordinator[0]?.message).toBe(
				"Durable coordinator final report",
			);
			expect(result.run_summary.latest_terminal_message).not.toContain("OpenTUI");
			expect(result.run_summary.latest_terminal_message).not.toContain("noisy summary");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("get-team-status returns empty team status", () => {
		createSession(db, {
			id: "s1",
			project_root: "/p",
			worktree_path: "/w",
			parent_agent_kind: "pi",
		});
		createTaskTeam(db, { id: "tm_1", session_id: "s1", title: "One" });

		const result = runGetTeamStatus(ctx, { team_id: "tm_1" });

		expect("team_id" in result).toBe(true);
		if (!("team_id" in result)) return;
		expect(result.status).toBe("empty");
		expect(result.task_counts.total).toBe(0);
		expect(result.tasks).toEqual([]);
		expect(result.run_summary.observability).toBeUndefined();
	});

	it("get-team-status returns team_not_found", () => {
		const result = runGetTeamStatus(ctx, { team_id: "tm_missing" });

		expect("error" in result).toBe(true);
		if ("error" in result) expect(result.error.code).toBe("team_not_found");
	});
});

describe("submit-team-tasks", () => {
	it("submits multiple team tasks with positions", async () => {
		createSession(db, {
			id: "s1",
			project_root: "/p",
			worktree_path: "/w",
			parent_agent_kind: "pi",
		});
		createTaskTeam(db, { id: "tm_1", session_id: "s1", title: "Team" });

		const result = await runSubmitTeamTasks(ctx, {
			team_id: "tm_1",
			tasks: [
				{ objective: "Coordinate", agent_kind: "claude-code", position: "coordinator" },
				{ objective: "Work", agent_kind: "claude-code", position: "worker" },
			],
		});

		expect("accepted" in result).toBe(true);
		if (!("accepted" in result)) return;
		expect(result.accepted).toHaveLength(2);
		expect(result.rejected).toEqual([]);
		expect(result.accepted.map((item) => item.index)).toEqual([0, 1]);
		expect(result.accepted.map((item) => item.position)).toEqual(["coordinator", "worker"]);
		expect(getTaskById(db, result.accepted[0]?.task_id ?? "")?.team_id).toBe("tm_1");
	});

	it("team defaults: applies submit agent and model when team task omits them", async () => {
		const root = mkdtempSync(join(tmpdir(), "cuekit-team-submit-defaults-"));
		try {
			mkdirSync(join(root, ".git"), { recursive: true });
			writeFileSync(
				join(root, ".cuekit.yaml"),
				[
					"submit:",
					"  agent: claude-code",
					"  model: sonnet",
					"teams:",
					"  roles:",
					"    coordinator: planner",
					"",
				].join("\n"),
			);
			createSession(db, {
				id: "s_team_submit_defaults",
				project_root: root,
				worktree_path: root,
				parent_agent_kind: "pi",
			});
			createTaskTeam(db, {
				id: "tm_submit_defaults",
				session_id: "s_team_submit_defaults",
				title: "Team",
			});

			const result = await runSubmitTeamTasks(ctx, {
				team_id: "tm_submit_defaults",
				tasks: [{ objective: "Plan", position: "coordinator", cwd: root }],
			});

			expect("accepted" in result).toBe(true);
			if (!("accepted" in result)) return;
			expect(result.rejected).toEqual([]);
			expect(result.accepted[0]).toMatchObject({
				agent_kind: "claude-code",
				role: "planner",
				position: "coordinator",
				model: "sonnet",
			});
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("team defaults: per-task null timeout disables project timeout default", async () => {
		const root = mkdtempSync(join(tmpdir(), "cuekit-team-null-timeout-"));
		try {
			mkdirSync(join(root, ".git"), { recursive: true });
			writeFileSync(
				join(root, ".cuekit.yaml"),
				"submit:\n  agent: claude-code\n  timeout_ms: 180000\n",
			);
			createSession(db, {
				id: "s_team_null_timeout",
				project_root: root,
				worktree_path: root,
				parent_agent_kind: "pi",
			});
			createTaskTeam(db, {
				id: "tm_null_timeout",
				session_id: "s_team_null_timeout",
				title: "Team",
			});

			const result = await runSubmitTeamTasks(ctx, {
				team_id: "tm_null_timeout",
				tasks: [{ objective: "Review without timeout", timeout_ms: null }],
			});

			expect("accepted" in result).toBe(true);
			if (!("accepted" in result)) return;
			expect(result.rejected).toEqual([]);
			const spec = JSON.parse(
				getTaskById(db, result.accepted[0]?.task_id ?? "")?.spec_json ?? "{}",
			);
			expect(spec).not.toHaveProperty("timeout_ms");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("warns when a team coordinator task explicitly uses batch mode", async () => {
		createSession(db, {
			id: "s_team_batch_coord",
			project_root: "/p",
			worktree_path: "/w",
			parent_agent_kind: "pi",
		});
		createTaskTeam(db, { id: "tm_batch_coord", session_id: "s_team_batch_coord", title: "Team" });

		const result = await runSubmitTeamTasks(ctx, {
			team_id: "tm_batch_coord",
			tasks: [
				{
					objective: "Coordinate",
					agent_kind: "claude-code",
					position: "coordinator",
					adapter_options: { mode: "batch" },
				},
				{
					objective: "Work",
					agent_kind: "claude-code",
					position: "worker",
					adapter_options: { mode: "batch" },
				},
				{
					objective: "Review",
					agent_kind: "claude-code",
					position: "reviewer",
					adapter_options: { mode: "batch" },
				},
				{
					objective: "Observe",
					agent_kind: "claude-code",
					position: "observer",
					adapter_options: { mode: "batch" },
				},
				{
					objective: "Coordinate interactively",
					agent_kind: "claude-code",
					position: "coordinator",
				},
			],
		});

		expect("accepted" in result).toBe(true);
		if (!("accepted" in result)) return;
		expect(result.accepted[0]?.warnings).toEqual([
			{
				code: "coordinator_batch_mode",
				message:
					"Coordinator tasks are orchestration-heavy; batch mode may stall or be unsteerable. Prefer interactive mode for coordination and use batch for focused worker/reviewer tasks.",
			},
		]);
		expect(result.accepted[1]?.warnings).toBeUndefined();
		expect(result.accepted[2]?.warnings).toBeUndefined();
		expect(result.accepted[3]?.warnings).toBeUndefined();
		expect(result.accepted[4]?.warnings).toBeUndefined();
	});

	it("team defaults: applies configured roles by position and safe permissions", async () => {
		const root = mkdtempSync(join(tmpdir(), "cuekit-team-defaults-"));
		try {
			mkdirSync(join(root, ".git"), { recursive: true });
			mkdirSync(join(root, ".cuekit", "agents"), { recursive: true });
			writeFileSync(
				join(root, ".cuekit.yaml"),
				"teams:\n  roles:\n    coordinator: lead\n    worker: implementer\n",
			);
			writeFileSync(
				join(root, ".cuekit", "agents", "lead.md"),
				"---\nid: lead\ndescription: Lead\nagent_kind: claude-code\n---\nLead instructions",
			);
			writeFileSync(
				join(root, ".cuekit", "agents", "implementer.md"),
				"---\nid: implementer\ndescription: Implement\nagent_kind: claude-code\n---\nImplement instructions",
			);
			createSession(db, {
				id: "s_team_defaults",
				project_root: root,
				worktree_path: root,
				parent_agent_kind: "pi",
			});
			createTaskTeam(db, { id: "tm_defaults", session_id: "s_team_defaults", title: "Team" });

			const result = await runSubmitTeamTasks(ctx, {
				team_id: "tm_defaults",
				tasks: [
					{ objective: "Coordinate", position: "coordinator" },
					{ objective: "Work", position: "worker" },
				],
			});

			expect("accepted" in result).toBe(true);
			if (!("accepted" in result)) return;
			expect(result.rejected).toEqual([]);
			expect(result.accepted.map((item) => item.role)).toEqual(["lead", "implementer"]);
			for (const item of result.accepted) {
				const spec = JSON.parse(getTaskById(db, item.task_id)?.spec_json ?? "{}");
				expect(spec.adapter_options).toEqual({ dangerously_skip_permissions: false });
			}
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("team defaults: explicit per-task role wins over configured position role", async () => {
		const root = mkdtempSync(join(tmpdir(), "cuekit-team-defaults-explicit-"));
		try {
			mkdirSync(join(root, ".git"), { recursive: true });
			mkdirSync(join(root, ".cuekit", "agents"), { recursive: true });
			writeFileSync(join(root, ".cuekit.yaml"), "teams:\n  roles:\n    worker: implementer\n");
			writeFileSync(
				join(root, ".cuekit", "agents", "explicit.md"),
				"---\nid: explicit\ndescription: Explicit\nagent_kind: claude-code\n---\nExplicit instructions",
			);
			createSession(db, {
				id: "s_team_defaults_explicit",
				project_root: root,
				worktree_path: root,
				parent_agent_kind: "pi",
			});
			createTaskTeam(db, {
				id: "tm_defaults_explicit",
				session_id: "s_team_defaults_explicit",
				title: "Team",
			});

			const result = await runSubmitTeamTasks(ctx, {
				team_id: "tm_defaults_explicit",
				tasks: [{ objective: "Work", position: "worker", role: "explicit" }],
			});

			expect("accepted" in result).toBe(true);
			if (!("accepted" in result)) return;
			expect(result.accepted[0]?.role).toBe("explicit");
			const spec = JSON.parse(
				getTaskById(db, result.accepted[0]?.task_id ?? "")?.spec_json ?? "{}",
			);
			expect(spec.adapter_options).toBeUndefined();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("returns a path-aware error when no agent can be resolved", async () => {
		createSession(db, {
			id: "s_team_missing_agent",
			project_root: "/p",
			worktree_path: "/w",
			parent_agent_kind: "pi",
		});
		createTaskTeam(db, {
			id: "tm_missing_agent",
			session_id: "s_team_missing_agent",
			title: "Team",
		});

		const result = await runSubmitTeamTasks(ctx, {
			team_id: "tm_missing_agent",
			tasks: [{ objective: "Work", position: "worker" }],
		});

		expect("accepted" in result).toBe(true);
		if (!("accepted" in result)) return;
		expect(result.accepted).toEqual([]);
		expect(result.rejected[0]?.error.message).toContain("tasks[0].agent_kind");
	});

	it("returns field paths for malformed team task input", async () => {
		createSession(db, {
			id: "s_team_paths",
			project_root: "/p",
			worktree_path: "/w",
			parent_agent_kind: "pi",
		});
		createTaskTeam(db, { id: "tm_paths", session_id: "s_team_paths", title: "Team" });

		const result = await runSubmitTeamTasks(ctx, {
			team_id: "tm_paths",
			tasks: [{ objective: "", agent_kind: "claude-code", position: "worker" }],
		});

		expect("accepted" in result).toBe(true);
		if (!("accepted" in result)) return;
		expect(result.rejected[0]?.error.message).toContain("tasks[0].objective");
	});

	it("accepts unpositioned team tasks with a warning instead of hard-rejecting", async () => {
		createSession(db, {
			id: "s_team_unpositioned",
			project_root: "/p",
			worktree_path: "/w",
			parent_agent_kind: "pi",
		});
		createTaskTeam(db, { id: "tm_unpositioned", session_id: "s_team_unpositioned", title: "Team" });

		const result = await runSubmitTeamTasks(ctx, {
			team_id: "tm_unpositioned",
			tasks: [{ objective: "Scout without a lane", agent_kind: "claude-code" }],
		});

		expect("accepted" in result).toBe(true);
		if (!("accepted" in result)) return;
		expect(result.rejected).toEqual([]);
		expect(result.accepted[0]).toMatchObject({
			index: 0,
			agent_kind: "claude-code",
			warnings: [expect.objectContaining({ code: "missing_team_position" })],
		});
		expect(result.accepted[0]?.position).toBeUndefined();
	});

	it("keeps accepted tasks when later task input is malformed", async () => {
		createSession(db, {
			id: "s1",
			project_root: "/p",
			worktree_path: "/w",
			parent_agent_kind: "pi",
		});
		createTaskTeam(db, { id: "tm_1", session_id: "s1", title: "Team" });

		const result = await runSubmitTeamTasks(ctx, {
			team_id: "tm_1",
			tasks: [
				{ objective: "Work", agent_kind: "claude-code", position: "worker" },
				{ objective: "", agent_kind: "claude-code", position: "worker" },
			],
		});

		expect("accepted" in result).toBe(true);
		if (!("accepted" in result)) return;
		expect(result.accepted).toHaveLength(1);
		expect(result.rejected).toHaveLength(1);
		expect(result.rejected[0]?.index).toBe(1);
		expect(result.rejected[0]?.error.code).toBe("invalid_input");
	});

	it("keeps accepted tasks when later team tasks are rejected", async () => {
		createSession(db, {
			id: "s1",
			project_root: "/p",
			worktree_path: "/w",
			parent_agent_kind: "pi",
		});
		createTaskTeam(db, { id: "tm_1", session_id: "s1", title: "Team" });

		const result = await runSubmitTeamTasks(ctx, {
			team_id: "tm_1",
			tasks: [
				{ objective: "Work", agent_kind: "claude-code", position: "worker" },
				{ objective: "Bad", agent_kind: "missing-adapter", position: "worker" },
			],
		});

		expect("accepted" in result).toBe(true);
		if (!("accepted" in result)) return;
		expect(result.accepted).toHaveLength(1);
		expect(result.rejected).toHaveLength(1);
		expect(result.rejected[0]?.index).toBe(1);
	});

	it("accepts task cwd inside a team session subdirectory", async () => {
		createSession(db, {
			id: "s1",
			project_root: "/repo",
			worktree_path: "/repo",
			parent_agent_kind: "pi",
		});
		createTaskTeam(db, { id: "tm_1", session_id: "s1", title: "Team" });

		const result = await runSubmitTeamTasks(ctx, {
			team_id: "tm_1",
			tasks: [{ objective: "Work", agent_kind: "claude-code", cwd: "/repo/packages/mcp" }],
		});

		expect("accepted" in result).toBe(true);
		if (!("accepted" in result)) return;
		expect(result.accepted).toHaveLength(1);
		expect(result.rejected).toEqual([]);
	});

	it("accepts in-worktree cwd segments that start with dotdot text", async () => {
		createSession(db, {
			id: "s1",
			project_root: "/repo",
			worktree_path: "/repo",
			parent_agent_kind: "pi",
		});
		createTaskTeam(db, { id: "tm_1", session_id: "s1", title: "Team" });

		const result = await runSubmitTeamTasks(ctx, {
			team_id: "tm_1",
			tasks: [{ objective: "Work", agent_kind: "claude-code", cwd: "/repo/..cache" }],
		});

		expect("accepted" in result).toBe(true);
		if (!("accepted" in result)) return;
		expect(result.accepted).toHaveLength(1);
		expect(result.rejected).toEqual([]);
	});

	it("rejects path-prefix sibling cwd outside the team session", async () => {
		createSession(db, {
			id: "s1",
			project_root: "/repo",
			worktree_path: "/repo",
			parent_agent_kind: "pi",
		});
		createTaskTeam(db, { id: "tm_1", session_id: "s1", title: "Team" });

		const result = await runSubmitTeamTasks(ctx, {
			team_id: "tm_1",
			tasks: [{ objective: "Work", agent_kind: "claude-code", cwd: "/repo2" }],
		});

		expect("accepted" in result).toBe(true);
		if (!("accepted" in result)) return;
		expect(result.accepted).toEqual([]);
		expect(result.rejected[0]?.error.code).toBe("invalid_input");
	});

	it("rejects task cwd outside the team session", async () => {
		createSession(db, {
			id: "s1",
			project_root: "/p",
			worktree_path: "/w",
			parent_agent_kind: "pi",
		});
		createTaskTeam(db, { id: "tm_1", session_id: "s1", title: "Team" });

		const result = await runSubmitTeamTasks(ctx, {
			team_id: "tm_1",
			tasks: [{ objective: "Work", agent_kind: "claude-code", cwd: "/elsewhere" }],
		});

		expect("accepted" in result).toBe(true);
		if (!("accepted" in result)) return;
		expect(result.accepted).toEqual([]);
		expect(result.rejected[0]?.error.code).toBe("invalid_input");
	});

	it("returns team_not_found for unknown teams", async () => {
		const result = await runSubmitTeamTasks(ctx, {
			team_id: "tm_missing",
			tasks: [{ objective: "Work", agent_kind: "claude-code" }],
		});

		expect("error" in result).toBe(true);
		if ("error" in result) expect(result.error.code).toBe("team_not_found");
	});
});

describe("wait-team and cleanup-team", () => {
	it("wait-team returns immediately for an empty team", async () => {
		createSession(db, {
			id: "s1",
			project_root: "/p",
			worktree_path: "/w",
			parent_agent_kind: "pi",
		});
		createTaskTeam(db, { id: "tm_1", session_id: "s1", title: "Team" });

		const result = await runWaitTeam(ctx, { team_id: "tm_1", timeout_ms: 0 });

		expect(result.status).toBe("empty");
		expect(result.done).toBe(true);
		expect(result.tasks).toEqual([]);
	});

	it("wait-team waits over the snapshotted team tasks", async () => {
		createSession(db, {
			id: "s1",
			project_root: "/p",
			worktree_path: "/w",
			parent_agent_kind: "pi",
		});
		createTaskTeam(db, { id: "tm_1", session_id: "s1", title: "Team" });
		createTask(db, {
			id: "t_done",
			session_id: "s1",
			agent_kind: "claude-code",
			team_id: "tm_1",
			team_position: "worker",
			objective: "done",
			status: "completed",
		});
		appendTaskEvent(db, {
			id: "e_done",
			task_id: "t_done",
			type: "completed",
			message: "Worker finished implementation",
		});

		const result = await runWaitTeam(ctx, { team_id: "tm_1", timeout_ms: 0 });

		expect(result.status).toBe("completed");
		expect(result.done).toBe(true);
		expect(result.tasks.map((task) => task.task_id)).toEqual(["t_done"]);
		expect(result.run_summary.positions.worker[0]?.message).toBe("Worker finished implementation");
		expect(result.run_summary.attention_items?.[0]).toMatchObject({
			task_id: "t_done",
			position: "worker",
			type: "completed",
			reason: "terminal_report",
			message: "Worker finished implementation",
		});
		expect(result.cleanup_hint).toContain("cuekit_cleanup");
		expect(result.cleanup_hint).toContain("tm_1");
	});

	it("team defaults: wait-team uses configured wait defaults and explicit input wins", async () => {
		const root = mkdtempSync(join(tmpdir(), "cuekit-team-wait-defaults-"));
		try {
			writeFileSync(
				join(root, ".cuekit.yaml"),
				"teams:\n  wait:\n    timeout_ms: 0\n    poll_interval_ms: 1\n",
			);
			createSession(db, {
				id: "s_wait_defaults",
				project_root: root,
				worktree_path: root,
				parent_agent_kind: "pi",
			});
			createTaskTeam(db, { id: "tm_wait_defaults", session_id: "s_wait_defaults", title: "Team" });
			const submitted = await runSubmitTask(ctx, {
				objective: "run",
				agent_kind: "claude-code",
				session_id: "s_wait_defaults",
				team_id: "tm_wait_defaults",
			});
			expect(submitted.accepted).toBe(true);

			const fromConfig = await runWaitTeam(ctx, { team_id: "tm_wait_defaults" });
			expect(fromConfig.timed_out).toBe(true);
			expect(fromConfig.next_action_hint).toContain("poll again");
			expect(fromConfig.cleanup_hint).toBeUndefined();

			const explicit = await runWaitTeam(ctx, {
				team_id: "tm_wait_defaults",
				timeout_ms: 1,
				poll_interval_ms: 1,
			});
			expect(explicit.timed_out).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("wait-team defaults to a snapshot and ignores tasks added after waiting starts", async () => {
		createSession(db, {
			id: "s_wait_snapshot",
			project_root: "/p",
			worktree_path: "/w",
			parent_agent_kind: "pi",
		});
		createTaskTeam(db, { id: "tm_wait_snapshot", session_id: "s_wait_snapshot", title: "Team" });
		const coordinator = await runSubmitTask(ctx, {
			objective: "coordinate",
			agent_kind: "claude-code",
			session_id: "s_wait_snapshot",
			team_id: "tm_wait_snapshot",
		});
		expect(coordinator.accepted).toBe(true);
		setTimeout(() => {
			createTask(db, {
				id: "t_late_worker_snapshot",
				session_id: "s_wait_snapshot",
				team_id: "tm_wait_snapshot",
				agent_kind: "claude-code",
				objective: "late worker",
				status: "running",
			});
		}, 5);

		const result = await runWaitTeam(ctx, {
			team_id: "tm_wait_snapshot",
			timeout_ms: 30,
			poll_interval_ms: 5,
		});

		expect(result.timed_out).toBe(true);
		expect(result.tasks.map((task) => task.task_id)).toEqual([
			coordinator.accepted ? coordinator.task_id : "",
		]);
	});

	it("wait-team can follow tasks added after waiting starts", async () => {
		createSession(db, {
			id: "s_wait_follow",
			project_root: "/p",
			worktree_path: "/w",
			parent_agent_kind: "pi",
		});
		createTaskTeam(db, { id: "tm_wait_follow", session_id: "s_wait_follow", title: "Team" });
		const coordinator = await runSubmitTask(ctx, {
			objective: "coordinate",
			agent_kind: "claude-code",
			session_id: "s_wait_follow",
			team_id: "tm_wait_follow",
		});
		expect(coordinator.accepted).toBe(true);
		setTimeout(() => {
			createTask(db, {
				id: "t_late_worker_follow",
				session_id: "s_wait_follow",
				team_id: "tm_wait_follow",
				agent_kind: "claude-code",
				objective: "late worker",
				status: "running",
			});
		}, 5);

		const result = await runWaitTeam(ctx, {
			team_id: "tm_wait_follow",
			timeout_ms: 30,
			poll_interval_ms: 5,
			follow_new_tasks: true,
		});

		expect(result.timed_out).toBe(true);
		expect(result.tasks.map((task) => task.task_id).sort()).toEqual(
			[coordinator.accepted ? coordinator.task_id : "", "t_late_worker_follow"].sort(),
		);
		expect(result.next_action_hint).toContain("newly created team tasks");
	});

	it("cleanup-team deletes terminal team tasks and keeps the team row", async () => {
		createSession(db, {
			id: "s1",
			project_root: "/p",
			worktree_path: "/w",
			parent_agent_kind: "pi",
		});
		createTaskTeam(db, { id: "tm_1", session_id: "s1", title: "Team" });
		createTask(db, {
			id: "t_done",
			session_id: "s1",
			agent_kind: "claude-code",
			team_id: "tm_1",
			objective: "done",
			status: "completed",
		});
		createTask(db, {
			id: "t_run",
			session_id: "s1",
			agent_kind: "claude-code",
			team_id: "tm_1",
			objective: "run",
			status: "running",
		});

		const result = await runCleanupTeam(ctx, { team_id: "tm_1" });

		expect("deleted" in result).toBe(true);
		if (!("deleted" in result)) return;
		expect(result.deleted.map((task) => task.task_id)).toEqual(["t_done"]);
		expect(result.remaining.total).toBe(1);
		expect(getTaskById(db, "t_done")).toBeNull();
		expect(getTaskById(db, "t_run")?.status).toBe("running");
		expect(runGetTeamStatus(ctx, { team_id: "tm_1" })).toMatchObject({ team_id: "tm_1" });
	});

	it("cleanup-team kills the backend team session when all members are deleted", async () => {
		const killedTeams: string[] = [];
		const basePanes = ctx.panes as TmuxBackend & {
			killTeamSession?: (teamId: string) => Promise<void>;
		};
		basePanes.killTeamSession = async (teamId: string) => {
			killedTeams.push(teamId);
		};
		createSession(db, {
			id: "s_cleanup_all",
			project_root: "/p",
			worktree_path: "/w",
			parent_agent_kind: "pi",
		});
		createTaskTeam(db, { id: "tm_cleanup_all", session_id: "s_cleanup_all", title: "Team" });
		createTask(db, {
			id: "t_done_all",
			session_id: "s_cleanup_all",
			agent_kind: "claude-code",
			team_id: "tm_cleanup_all",
			objective: "done",
			status: "completed",
		});

		const result = await runCleanupTeam(ctx, { team_id: "tm_cleanup_all" });

		expect("deleted" in result).toBe(true);
		expect(killedTeams).toEqual(["tm_cleanup_all"]);
	});

	it("cleanup-team returns team_not_found for unknown teams", async () => {
		const result = await runCleanupTeam(ctx, { team_id: "tm_missing" });

		expect("error" in result).toBe(true);
		if ("error" in result) expect(result.error.code).toBe("team_not_found");
	});
});

describe("team result", () => {
	it("returns an event-first timeline and coordinator final summary", () => {
		createSession(db, {
			id: "s_team_result",
			project_root: "/p",
			worktree_path: "/w",
			parent_agent_kind: "pi",
		});
		createTaskTeam(db, { id: "tm_result", session_id: "s_team_result", title: "Team" });
		createTask(db, {
			id: "t_worker_result",
			session_id: "s_team_result",
			team_id: "tm_result",
			team_position: "worker",
			agent_kind: "claude-code",
			objective: "work",
			status: "completed",
		});
		createTask(db, {
			id: "t_reviewer_result",
			session_id: "s_team_result",
			team_id: "tm_result",
			team_position: "reviewer",
			agent_kind: "claude-code",
			objective: "review",
			status: "completed",
		});
		createTask(db, {
			id: "t_finisher_result",
			session_id: "s_team_result",
			team_id: "tm_result",
			team_position: "finisher",
			agent_kind: "claude-code",
			objective: "finish",
			status: "completed",
		});
		createTask(db, {
			id: "t_coordinator_result",
			session_id: "s_team_result",
			team_id: "tm_result",
			team_position: "coordinator",
			agent_kind: "pi",
			objective: "coordinate",
			status: "completed",
		});
		const longWorkerResultMessage = `worker final report ${"x".repeat(260)}`;
		appendTaskEvent(db, {
			id: "e_worker_result",
			task_id: "t_worker_result",
			type: "completed",
			message: longWorkerResultMessage,
		});
		appendTaskEvent(db, {
			id: "e_reviewer_result",
			task_id: "t_reviewer_result",
			type: "completed",
			message: "reviewer final report",
		});
		appendTaskEvent(db, {
			id: "e_finisher_result",
			task_id: "t_finisher_result",
			type: "completed",
			message: "finisher final report",
		});
		appendTaskEvent(db, {
			id: "e_coordinator_result",
			task_id: "t_coordinator_result",
			type: "completed",
			message: "coordinator final report",
		});

		const result = runGetTeamResult(ctx, { team_id: "tm_result" });

		expect("error" in result).toBe(false);
		if ("error" in result) return;
		expect(result.status).toBe("completed");
		expect(result.task_counts.completed).toBe(4);
		expect(result.final_summary).toContain("coordinator final report");
		expect(result.timeline.map((event) => event.position)).toEqual([
			"worker",
			"reviewer",
			"finisher",
			"coordinator",
		]);
		expect(result.timeline.map((event) => event.message)).toEqual([
			longWorkerResultMessage,
			"reviewer final report",
			"finisher final report",
			"coordinator final report",
		]);
		expect(result.attention_items?.map((item) => item.position)).toEqual([
			"worker",
			"reviewer",
			"finisher",
		]);
		expect(result.attention_items?.map((item) => item.message)).toEqual([
			longWorkerResultMessage,
			"reviewer final report",
			"finisher final report",
		]);
		expect(result.attention_items?.[0]?.message).toHaveLength(longWorkerResultMessage.length);
		expect(result.attention_items?.some((item) => item.position === "coordinator")).toBe(false);
		expect(result.cleanup_hint).toContain("cuekit_cleanup");
		expect(result.cleanup_hint).toContain("tm_result");
	});

	it("omits cleanup hint when a team result has no terminal tasks", () => {
		createSession(db, {
			id: "s_team_result_running",
			project_root: "/p",
			worktree_path: "/w",
			parent_agent_kind: "pi",
		});
		createTaskTeam(db, {
			id: "tm_result_running",
			session_id: "s_team_result_running",
			title: "Team",
		});
		createTask(db, {
			id: "t_worker_result_running",
			session_id: "s_team_result_running",
			team_id: "tm_result_running",
			team_position: "worker",
			agent_kind: "claude-code",
			objective: "work",
			status: "running",
		});

		const result = runGetTeamResult(ctx, { team_id: "tm_result_running" });

		expect("error" in result).toBe(false);
		if ("error" in result) return;
		expect(result.cleanup_hint).toBeUndefined();
	});

	it("team result returns team_not_found for unknown teams", () => {
		const result = runGetTeamResult(ctx, { team_id: "tm_missing" });

		expect("error" in result).toBe(true);
		if ("error" in result) expect(result.error.code).toBe("team_not_found");
	});
});

describe("delete-team", () => {
	it("deletes an empty team", () => {
		createSession(db, {
			id: "s_delete_team",
			project_root: "/p",
			worktree_path: "/w",
			parent_agent_kind: "pi",
		});
		createTaskTeam(db, { id: "tm_delete", session_id: "s_delete_team", title: "Delete" });

		const result = runDeleteTeam(ctx, { team_id: "tm_delete" });

		expect(result).toEqual({ ok: true, team_id: "tm_delete" });
		expect(runGetTeamStatus(ctx, { team_id: "tm_delete" })).toMatchObject({
			error: { code: "team_not_found" },
		});
	});

	it("refuses to delete a team with tasks", () => {
		createSession(db, {
			id: "s_delete_nonempty_team",
			project_root: "/p",
			worktree_path: "/w",
			parent_agent_kind: "pi",
		});
		createTaskTeam(db, {
			id: "tm_delete_nonempty",
			session_id: "s_delete_nonempty_team",
			title: "Delete",
		});
		createTask(db, {
			id: "t_delete_member",
			session_id: "s_delete_nonempty_team",
			team_id: "tm_delete_nonempty",
			agent_kind: "claude-code",
			objective: "work",
			status: "completed",
		});

		const result = runDeleteTeam(ctx, { team_id: "tm_delete_nonempty" });

		expect("error" in result).toBe(true);
		if ("error" in result) expect(result.error.code).toBe("team_not_empty");
		expect(runGetTeamStatus(ctx, { team_id: "tm_delete_nonempty" })).toMatchObject({
			team_id: "tm_delete_nonempty",
		});
	});

	it("delete-team returns team_not_found for unknown teams", () => {
		const result = runDeleteTeam(ctx, { team_id: "tm_missing" });

		expect("error" in result).toBe(true);
		if ("error" in result) expect(result.error.code).toBe("team_not_found");
	});
});

describe("strategy commands", () => {
	it("lists configured team strategies", () => {
		const root = mkdtempSync(join(tmpdir(), "cuekit-strategy-list-"));
		try {
			writeFileSync(
				join(root, ".cuekit.yaml"),
				`strategies:
  docs-polish:
    description: Docs polish
    intent: Improve docs.
    checks:
      - bun run check
  bugfix:
    description: Bugfix
`,
			);

			const result = runListStrategies(ctx, { cwd: root });

			expect("strategies" in result).toBe(true);
			if (!("strategies" in result)) return;
			expect(result.strategies.map((strategy) => strategy.name)).toEqual(["bugfix", "docs-polish"]);
			expect(result.strategies[1]?.checks).toEqual(["bun run check"]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("shows one configured team strategy with rendered prompt", () => {
		const root = mkdtempSync(join(tmpdir(), "cuekit-strategy-show-"));
		try {
			writeFileSync(
				join(root, ".cuekit.yaml"),
				`strategies:
  docs-polish:
    description: Docs polish
    intent: Improve docs.
    recommended_team:
      worker:
        position: worker
        agent: pi
    checks:
      - bun run check
`,
			);

			const result = runListStrategies(ctx, {
				cwd: root,
				strategy: "docs-polish",
				include_prompt: true,
				objective: "Polish README",
			});

			expect("strategy" in result).toBe(true);
			if (!("strategy" in result)) return;
			expect(result.strategy.name).toBe("docs-polish");
			expect(result.strategy.rendered_prompt).toContain("Checks:");
			expect(result.strategy.rendered_prompt).toContain("Polish README");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("returns an empty strategy list when no project config exists", () => {
		const root = mkdtempSync(join(tmpdir(), "cuekit-strategy-empty-"));
		try {
			const result = runListStrategies(ctx, { cwd: root });

			expect("strategies" in result).toBe(true);
			if (!("strategies" in result)) return;
			expect(result.strategies).toEqual([]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("returns strategy_not_found for unknown named strategies", () => {
		const root = mkdtempSync(join(tmpdir(), "cuekit-strategy-missing-"));
		try {
			writeFileSync(
				join(root, ".cuekit.yaml"),
				"strategies:\n  docs-polish:\n    description: Docs\n",
			);

			const result = runListStrategies(ctx, { cwd: root, strategy: "missing" });

			expect("error" in result).toBe(true);
			if ("error" in result) expect(result.error.code).toBe("strategy_not_found");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("returns invalid_input when prompt-only fields are provided without a strategy name", () => {
		const root = mkdtempSync(join(tmpdir(), "cuekit-strategy-invalid-input-"));
		try {
			const result = runListStrategies(ctx, {
				cwd: root,
				include_prompt: true,
				objective: "Render without a strategy",
			});

			expect("error" in result).toBe(true);
			if ("error" in result) expect(result.error.code).toBe("invalid_input");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("describes detailed strategy output with the team strategy schema", () => {
		const parsed = ListStrategiesOutputSchema.safeParse({
			strategy: {
				name: "bad",
				strategy: { validation: ["bun test"] },
			},
		});

		expect(parsed.success).toBe(false);
	});
});

describe("start team strategy", () => {
	it("creates a team and submits one coordinator with rendered strategy guidance", async () => {
		const root = mkdtempSync(join(tmpdir(), "cuekit-start-strategy-"));
		try {
			writeFileSync(
				join(root, ".cuekit.yaml"),
				`project:
  id: strategy-test
strategies:
  docs-polish:
    description: Docs polish
    intent: Keep docs-only.
    recommended_team:
      coordinator:
        position: coordinator
        role: planner
        agent: claude-code
        model: sonnet
      reviewer:
        position: reviewer
        role: reviewer
        agent: claude-code
    checks:
      - git diff --check
`,
			);

			const result = await runStartTeamStrategy(ctx, {
				cwd: root,
				strategy: "docs-polish",
				objective: "Polish README wait guidance",
			});

			expect(result.accepted).toBe(true);
			if (!result.accepted) return;
			expect(result.team_id).toMatch(/^tm_/);
			expect(result.coordinator_task_id).toMatch(/^t_/);
			expect(result.agent_kind).toBe("claude-code");
			expect(result.role).toBe("planner");
			expect(result.model).toBe("sonnet");
			const task = getTaskById(db, result.coordinator_task_id);
			expect(task?.team_id).toBe(result.team_id);
			expect(task?.team_position).toBe("coordinator");
			const spec = JSON.parse(task?.spec_json ?? "{}");
			expect(spec.team_context?.position).toBe("coordinator");
			expect(spec.context).toContain("Team strategy: docs-polish");
			expect(spec.context).toContain("Checks:");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("warns when a strategy coordinator explicitly uses batch mode", async () => {
		const root = mkdtempSync(join(tmpdir(), "cuekit-start-strategy-batch-warning-"));
		try {
			writeFileSync(
				join(root, ".cuekit.yaml"),
				`strategies:
  docs-polish:
    recommended_team:
      coordinator:
        position: coordinator
        role: planner
        agent: claude-code
        model: sonnet
`,
			);

			const result = await runStartTeamStrategy(ctx, {
				cwd: root,
				strategy: "docs-polish",
				objective: "Polish README",
				coordinator: { adapter_options: { mode: "batch" } },
			});

			expect(result.accepted).toBe(true);
			if (!result.accepted) return;
			expect(result.warnings).toEqual([
				{
					code: "coordinator_batch_mode",
					message:
						"Coordinator tasks are orchestration-heavy; batch mode may stall or be unsteerable. Prefer interactive mode for coordination and use batch for focused worker/reviewer tasks.",
				},
			]);
			const task = getTaskById(db, result.coordinator_task_id);
			const spec = JSON.parse(task?.spec_json ?? "{}");
			expect(spec.adapter_options?.mode).toBe("batch");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("warns when a strategy coordinator slot uses batch mode", async () => {
		const root = mkdtempSync(join(tmpdir(), "cuekit-start-strategy-slot-batch-warning-"));
		try {
			writeFileSync(
				join(root, ".cuekit.yaml"),
				`strategies:
  docs-polish:
    recommended_team:
      coordinator:
        position: coordinator
        role: planner
        agent: claude-code
        model: sonnet
        adapter_options:
          mode: batch
`,
			);

			const result = await runStartTeamStrategy(ctx, {
				cwd: root,
				strategy: "docs-polish",
				objective: "Polish README",
			});

			expect(result.accepted).toBe(true);
			if (!result.accepted) return;
			expect(result.warnings).toEqual([
				{
					code: "coordinator_batch_mode",
					message:
						"Coordinator tasks are orchestration-heavy; batch mode may stall or be unsteerable. Prefer interactive mode for coordination and use batch for focused worker/reviewer tasks.",
				},
			]);
			const task = getTaskById(db, result.coordinator_task_id);
			const spec = JSON.parse(task?.spec_json ?? "{}");
			expect(spec.adapter_options?.mode).toBe("batch");
			expect(spec.adapter_options?.dangerously_skip_permissions).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("lets explicit coordinator agent and model override strategy recommendations", async () => {
		const root = mkdtempSync(join(tmpdir(), "cuekit-start-strategy-override-"));
		try {
			writeFileSync(
				join(root, ".cuekit.yaml"),
				`strategies:
  docs-polish:
    recommended_team:
      coordinator:
        position: coordinator
        role: planner
        agent: pi
        model: k2p5
`,
			);

			const result = await runStartTeamStrategy(ctx, {
				cwd: root,
				strategy: "docs-polish",
				objective: "Polish README",
				coordinator: { agent_kind: "claude-code", model: "sonnet", role: "planner" },
			});

			expect(result.accepted).toBe(true);
			if (!result.accepted) return;
			expect(result.agent_kind).toBe("claude-code");
			expect(result.model).toBe("sonnet");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("starts a pi coordinator with a strategy-selected model", async () => {
		const root = mkdtempSync(join(tmpdir(), "cuekit-start-strategy-pi-model-"));
		try {
			writeFileSync(
				join(root, ".cuekit.yaml"),
				`strategies:
  docs-polish:
    recommended_team:
      coordinator:
        position: coordinator
        role: planner
        agent: pi
        model: openai-codex/gpt-5.5
`,
			);

			const result = await runStartTeamStrategy(ctx, {
				cwd: root,
				strategy: "docs-polish",
				objective: "Polish README",
			});

			expect(result.accepted).toBe(true);
			if (!result.accepted) return;
			expect(result.agent_kind).toBe("pi");
			expect(result.model).toBe("openai-codex/gpt-5.5");
			const task = getTaskById(db, result.coordinator_task_id);
			const spec = JSON.parse(task?.spec_json ?? "{}");
			expect(spec.agent_kind).toBe("pi");
			expect(spec.model).toBe("openai-codex/gpt-5.5");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("forces safe adapter options for coordinator roles from team defaults", async () => {
		const root = mkdtempSync(join(tmpdir(), "cuekit-start-strategy-team-role-"));
		try {
			writeFileSync(
				join(root, ".cuekit.yaml"),
				`teams:
  roles:
    coordinator: planner
strategies:
  docs-polish:
    recommended_team:
      coordinator:
        position: coordinator
        agent: claude-code
        model: sonnet
`,
			);

			const result = await runStartTeamStrategy(ctx, {
				cwd: root,
				strategy: "docs-polish",
				objective: "Polish README",
			});

			expect(result.accepted).toBe(true);
			if (!result.accepted) return;
			const task = getTaskById(db, result.coordinator_task_id);
			const spec = JSON.parse(task?.spec_json ?? "{}");
			expect(spec.role).toBe("planner");
			expect(spec.adapter_options?.dangerously_skip_permissions).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("returns strategy_not_found for missing start strategies", async () => {
		const root = mkdtempSync(join(tmpdir(), "cuekit-start-strategy-missing-"));
		try {
			writeFileSync(
				join(root, ".cuekit.yaml"),
				"strategies:\n  docs-polish:\n    description: Docs\n",
			);

			const result = await runStartTeamStrategy(ctx, {
				cwd: root,
				strategy: "missing",
				objective: "x",
			});

			expect(result.accepted).toBe(false);
			if (!result.accepted) expect(result.error.code).toBe("strategy_not_found");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("submit-task", () => {
	it("attaches submitted tasks to a team", async () => {
		createSession(db, {
			id: "s_team",
			project_root: "/team",
			worktree_path: "/team",
			parent_agent_kind: "pi",
		});
		createTaskTeam(db, { id: "tm_1", session_id: "s_team", title: "Team" });

		const result = await runSubmitTask(ctx, {
			objective: "Do team work",
			agent_kind: "claude-code",
			session_id: "s_team",
			team_id: "tm_1",
			position: "worker",
		});

		expect(result.accepted).toBe(true);
		if (!result.accepted) return;
		const task = getTaskById(db, result.task_id);
		expect(task?.team_id).toBe("tm_1");
		expect(task?.team_position).toBe("worker");
		expect(JSON.parse(task?.spec_json ?? "{}").team_context).toMatchObject({
			team_id: "tm_1",
			title: "Team",
			position: "worker",
		});
		const status = await runGetTaskStatus(ctx, { task_id: result.task_id });
		expect(status.team_id).toBe("tm_1");
		expect(status.position).toBe("worker");
		const listed = await runListTasks(ctx, { session_id: "s_team" });
		if ("error" in listed) throw new Error(listed.error.message);
		expect(listed.tasks[0]?.team_id).toBe("tm_1");
		expect(listed.tasks[0]?.position).toBe("worker");
	});

	it("rejects position without team_id", async () => {
		const result = await runSubmitTask(ctx, {
			objective: "Do team work",
			agent_kind: "claude-code",
			cwd: "/team",
			position: "worker",
		});

		expect(result.accepted).toBe(false);
		if (!result.accepted) expect(result.error.code).toBe("invalid_input");
	});

	it("rejects team metadata for a different session", async () => {
		createSession(db, {
			id: "s1",
			project_root: "/one",
			worktree_path: "/one",
			parent_agent_kind: "pi",
		});
		createSession(db, {
			id: "s2",
			project_root: "/two",
			worktree_path: "/two",
			parent_agent_kind: "pi",
		});
		createTaskTeam(db, { id: "tm_1", session_id: "s1", title: "Team" });

		const result = await runSubmitTask(ctx, {
			objective: "Do team work",
			agent_kind: "claude-code",
			session_id: "s2",
			team_id: "tm_1",
			position: "worker",
		});

		expect(result.accepted).toBe(false);
		if (!result.accepted) expect(result.error.code).toBe("invalid_input");
	});

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

	it("project config: persists identity when auto-creating a session from cwd", async () => {
		const root = mkdtempSync(join(tmpdir(), "cuekit-project-config-submit-"));
		try {
			const nested = join(root, "packages", "mcp");
			mkdirSync(nested, { recursive: true });
			writeFileSync(join(root, ".cuekit.yaml"), "project:\n  id: cuekit\n  name: Cuekit\n");

			const result = await runSubmitTask(ctx, {
				objective: "Use project config identity",
				agent_kind: "claude-code",
				cwd: nested,
			});

			expect(result.accepted).toBe(true);
			if (!result.accepted) return;
			const session = getSessionById(db, result.session_id);
			expect(session?.config_root).toBe(root);
			expect(session?.project_id).toBe("cuekit");
			expect(session?.project_name).toBe("Cuekit");
			expect(session?.project_uid).toMatch(/^pc_[a-f0-9]{16}$/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("project config: malformed config returns invalid_input without creating a session", async () => {
		const root = mkdtempSync(join(tmpdir(), "cuekit-project-config-bad-"));
		try {
			writeFileSync(join(root, ".cuekit.yaml"), "project: [");

			const result = await runSubmitTask(ctx, {
				objective: "Should fail",
				agent_kind: "claude-code",
				cwd: root,
			});

			expect(result.accepted).toBe(false);
			if (!result.accepted) {
				expect(result.error.code).toBe("invalid_input");
				expect(result.error.message).toContain("Failed to parse");
			}
			expect(listSessionsByWorktree(db, root)).toHaveLength(0);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("submit defaults: fills role agent model timeout and priority from project config safely", async () => {
		const root = mkdtempSync(join(tmpdir(), "cuekit-submit-defaults-"));
		try {
			writeFileSync(
				join(root, ".cuekit.yaml"),
				[
					"submit:",
					"  role: reviewer",
					"  agent: claude-code",
					"  model: sonnet",
					"  timeout_ms: 1234",
					"  priority: high",
				].join("\n"),
			);

			const result = await runSubmitTask(ctx, {
				objective: "Use defaults",
				cwd: root,
			});

			expect(result.accepted).toBe(true);
			if (!result.accepted) return;
			expect(result.agent_kind).toBe("claude-code");
			expect(result.role).toBe("reviewer");
			const spec = JSON.parse(getTaskById(db, result.task_id)?.spec_json ?? "{}");
			expect(spec.model).toBe("sonnet");
			expect(spec.timeout_ms).toBe(1234);
			expect(spec.priority).toBe("high");
			expect(spec.adapter_options).toEqual({ dangerously_skip_permissions: false });
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("submit defaults: explicit input wins and caller adapter options are preserved", async () => {
		const root = mkdtempSync(join(tmpdir(), "cuekit-submit-defaults-explicit-"));
		try {
			writeFileSync(
				join(root, ".cuekit.yaml"),
				"submit:\n  agent: pi\n  model: opus\n  timeout_ms: 1\n  priority: low\nadapters:\n  claude-code:\n    permissions: prompt\n",
			);

			const result = await runSubmitTask(ctx, {
				objective: "Use explicit values",
				agent_kind: "claude-code",
				model: "sonnet",
				timeout_ms: 2,
				priority: "high",
				adapter_options: { dangerously_skip_permissions: true },
				cwd: root,
			});

			expect(result.accepted).toBe(true);
			if (!result.accepted) return;
			expect(result.agent_kind).toBe("claude-code");
			const spec = JSON.parse(getTaskById(db, result.task_id)?.spec_json ?? "{}");
			expect(spec.model).toBe("sonnet");
			expect(spec.timeout_ms).toBe(2);
			expect(spec.priority).toBe("high");
			expect(spec.adapter_options).toEqual({ dangerously_skip_permissions: true });
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("submit defaults: explicit null timeout disables project timeout default", async () => {
		const root = mkdtempSync(join(tmpdir(), "cuekit-submit-defaults-null-timeout-"));
		try {
			writeFileSync(
				join(root, ".cuekit.yaml"),
				"submit:\n  agent: claude-code\n  timeout_ms: 180000\n",
			);

			const result = await runSubmitTask(ctx, {
				objective: "Run without task timeout",
				timeout_ms: null,
				cwd: root,
			});

			expect(result.accepted).toBe(true);
			if (!result.accepted) return;
			const spec = JSON.parse(getTaskById(db, result.task_id)?.spec_json ?? "{}");
			expect(spec).not.toHaveProperty("timeout_ms");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("submit defaults: profile agent and model win over config agent and model", async () => {
		const root = mkdtempSync(join(tmpdir(), "cuekit-submit-defaults-profile-"));
		try {
			mkdirSync(join(root, ".git"), { recursive: true });
			mkdirSync(join(root, ".cuekit", "agents"), { recursive: true });
			writeFileSync(
				join(root, ".cuekit.yaml"),
				"submit:\n  role: custom\n  agent: pi\n  model: opus\n",
			);
			writeFileSync(
				join(root, ".cuekit", "agents", "custom.md"),
				"---\nid: custom\ndescription: Custom profile\nagent_kind: claude-code\nmodel: haiku\n---\nProfile instructions",
			);

			const result = await runSubmitTask(ctx, {
				objective: "Use profile defaults",
				cwd: root,
			});

			expect(result.accepted).toBe(true);
			if (!result.accepted) return;
			expect(result.agent_kind).toBe("claude-code");
			const spec = JSON.parse(getTaskById(db, result.task_id)?.spec_json ?? "{}");
			expect(spec.model).toBe("haiku");
			expect(spec.adapter_options).toEqual({ dangerously_skip_permissions: false });
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("submit defaults: adapter permissions prompt forces safe options for explicit agent", async () => {
		const root = mkdtempSync(join(tmpdir(), "cuekit-submit-defaults-prompt-"));
		try {
			writeFileSync(
				join(root, ".cuekit.yaml"),
				"adapters:\n  claude-code:\n    permissions: prompt\n",
			);

			const result = await runSubmitTask(ctx, {
				objective: "Use prompt permissions",
				agent_kind: "claude-code",
				cwd: root,
			});

			expect(result.accepted).toBe(true);
			if (!result.accepted) return;
			const spec = JSON.parse(getTaskById(db, result.task_id)?.spec_json ?? "{}");
			expect(spec.adapter_options).toEqual({ dangerously_skip_permissions: false });
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("project config: explicit session_id does not mutate stored identity", async () => {
		const root = mkdtempSync(join(tmpdir(), "cuekit-project-config-explicit-"));
		try {
			writeFileSync(join(root, ".cuekit.yaml"), "project:\n  id: cuekit\n");
			createSession(db, {
				id: "s_explicit",
				project_root: root,
				worktree_path: root,
				parent_agent_kind: "pi",
			});

			const result = await runSubmitTask(ctx, {
				objective: "Use explicit session",
				agent_kind: "claude-code",
				session_id: "s_explicit",
				cwd: root,
			});

			expect(result.accepted).toBe(true);
			const session = getSessionById(db, "s_explicit");
			expect(session?.config_root).toBeNull();
			expect(session?.project_uid).toBeNull();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
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

	it("resolves an explicit role into agent_kind, model, and prompt metadata", async () => {
		const root = mkdtempSync(join(tmpdir(), "cuekit-submit-role-"));
		try {
			mkdirSync(join(root, ".git"));
			const result = await runSubmitTask(ctx, {
				objective: "review this",
				role: "reviewer",
				cwd: root,
			});
			expect(result.accepted).toBe(true);
			if (!result.accepted) return;
			expect(result.agent_kind).toBe("claude-code");
			expect(result.role).toBe("reviewer");
			const task = getTaskById(db, result.task_id);
			expect(task?.role).toBe("reviewer");
			expect(JSON.parse(task?.spec_json ?? "{}").role_instructions).toContain(
				"evidence-based reviewer",
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("uses session worktree when resolving an explicit role", async () => {
		const root = mkdtempSync(join(tmpdir(), "cuekit-submit-role-"));
		try {
			mkdirSync(join(root, ".git"));
			mkdirSync(join(root, ".cuekit", "agents"), { recursive: true });
			writeFileSync(
				join(root, ".cuekit", "agents", "reviewer.md"),
				"---\nid: reviewer\nmodel: bad-model\n---",
			);
			createSession(db, {
				id: "s_role",
				project_root: root,
				worktree_path: root,
				parent_agent_kind: "pi",
			});
			const result = await runSubmitTask(ctx, {
				objective: "review this",
				role: "reviewer",
				session_id: "s_role",
			});
			expect(result.accepted).toBe(false);
			if (!result.accepted) expect(result.error.code).toBe("invalid_input");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("returns invalid_input for an unknown explicit role", async () => {
		const result = await runSubmitTask(ctx, {
			objective: "x",
			role: "missing-role",
			cwd: "/tmp",
		});
		expect(result.accepted).toBe(false);
		if (!result.accepted) expect(result.error.code).toBe("invalid_input");
	});

	it("auto-selects roles from the objective", async () => {
		const result = await runSubmitTask(ctx, {
			objective: "update the README docs",
			role: "auto",
			cwd: "/tmp",
		});
		expect(result.accepted).toBe(true);
		if (!result.accepted) return;
		expect(result.role).toBe("docs-writer");
		expect(result.role_selection_reason).toContain("docs");
		const task = getTaskById(db, result.task_id);
		expect(task?.role).toBe("docs-writer");
		const status = await runGetTaskStatus(ctx, { task_id: result.task_id });
		expect(status.role).toBe("docs-writer");
		const list = await runListTasks(ctx, { session_id: result.session_id });
		expect("tasks" in list).toBe(true);
		if ("tasks" in list) expect(list.tasks[0]?.role).toBe("docs-writer");
	});

	it("exposes parent-session run metadata in list and status surfaces", async () => {
		const result = await runSubmitTask(ctx, {
			objective: "manage this project",
			agent_kind: "pi",
			cwd: "/tmp",
			metadata: { run_kind: "parent_session", long_lived: true, ignored: "private" },
		});
		expect(result.accepted).toBe(true);
		if (!result.accepted) return;

		const status = await runGetTaskStatus(ctx, { task_id: result.task_id });
		expect(status.run_kind).toBe("parent_session");
		expect(status.long_lived).toBe(true);
		expect(status.metadata?.ignored).toBeUndefined();

		const list = await runListTasks(ctx, { session_id: result.session_id });
		expect("tasks" in list).toBe(true);
		if ("tasks" in list) {
			expect(list.tasks[0]).toMatchObject({
				task_id: result.task_id,
				run_kind: "parent_session",
				long_lived: true,
			});
			expect((list.tasks[0] as { metadata?: unknown }).metadata).toBeUndefined();
		}
	});

	it("auto role selection uses session worktree discovery", async () => {
		const root = mkdtempSync(join(tmpdir(), "cuekit-submit-auto-role-"));
		try {
			mkdirSync(join(root, ".git"));
			mkdirSync(join(root, ".cuekit", "agents"), { recursive: true });
			writeFileSync(
				join(root, ".cuekit", "agents", "debugger.md"),
				"---\nid: debugger\nmodel: bad-model\n---",
			);
			createSession(db, {
				id: "s_auto_role",
				project_root: root,
				worktree_path: root,
				parent_agent_kind: "pi",
			});
			const result = await runSubmitTask(ctx, {
				objective: "debug failing tests",
				role: "auto",
				session_id: "s_auto_role",
			});
			expect(result.accepted).toBe(false);
			if (!result.accepted) expect(result.error.code).toBe("invalid_input");
		} finally {
			rmSync(root, { recursive: true, force: true });
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
		if ("task_id" in result) {
			expect(result.status).toBe("cancelled");
			expect(result.cleanup_hint).toContain(submit.task_id);
			expect(result.cleanup_hint).toContain("cuekit_delete");
		}
	});

	it("uses terminal child report message as summary fallback", async () => {
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
			message: "Implemented the refactor",
		});

		const result = await runGetTaskResult(ctx, { task_id: submit.task_id });

		expect("task_id" in result).toBe(true);
		if ("task_id" in result) expect(result.summary).toBe("Implemented the refactor");
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

	it("rejects duplicate task ids", async () => {
		const ack = await runCancelTasks(ctx, { task_ids: ["t_dup", "t_dup"] });
		expect(ack.ok).toBe(false);
		if (!ack.ok) expect(ack.error.message).toBe("duplicate task_id 't_dup'");
	});

	it("accepts a comma-separated task_ids string", async () => {
		const a = await runSubmitTask(ctx, { objective: "a", agent_kind: "claude-code", cwd: "/tmp" });
		const b = await runSubmitTask(ctx, { objective: "b", agent_kind: "claude-code", cwd: "/tmp" });
		if (!a.accepted || !b.accepted) throw new Error("setup failed");

		const ack = await runCancelTasks(ctx, { task_ids: [`${a.task_id},${b.task_id}`] });

		expect(ack.ok).toBe(true);
		if (ack.ok) expect(ack.tasks.map((t) => t.task_id)).toEqual([a.task_id, b.task_id]);
		expect(getTaskById(db, a.task_id)?.status).toBe("cancelled");
		expect(getTaskById(db, b.task_id)?.status).toBe("cancelled");
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

	it("leaves the adapter pane alive after a terminal report by default", async () => {
		const task_id = await submitWithChildToken();
		const sessionName = `cuekit-task-${task_id}`;
		expect(runner.knownSessions()).toContain(sessionName);

		const result = await runReportTaskEvent(ctx, {
			task_id,
			child_token: "data",
			type: "completed",
			message: "Done",
		});

		expect(result.ok).toBe(true);
		expect(getTaskById(db, task_id)?.status).toBe("completed");
		// The contract is "reporting does not close your pane or process".
		// Without the opt-in, the tmux session must stay alive.
		expect(runner.knownSessions()).toContain(sessionName);
	});

	it("kills the adapter pane on terminal report when cleanup_on_terminal_report is opted into", async () => {
		const submit = await runSubmitTask(ctx, {
			objective: "x",
			agent_kind: "claude-code",
			cwd: "/tmp",
			adapter_options: { cleanup_on_terminal_report: true },
		});
		if (!submit.accepted) throw new Error("setup failed");
		updateTaskChildTokenHash(
			db,
			submit.task_id,
			"sha256:3a6eb0790f39ac87c94f3856b2dd2c5d110e6811602261a9a923d3bb23adc8b7",
		);
		const sessionName = `cuekit-task-${submit.task_id}`;
		expect(runner.knownSessions()).toContain(sessionName);

		const result = await runReportTaskEvent(ctx, {
			task_id: submit.task_id,
			child_token: "data",
			type: "completed",
			message: "Done",
		});

		expect(result.ok).toBe(true);
		expect(getTaskById(db, submit.task_id)?.status).toBe("completed");
		expect(runner.knownSessions()).not.toContain(sessionName);
	});

	it("triggers cleanup for failed and blocked terminal reports too", async () => {
		for (const reportType of ["failed", "blocked"] as const) {
			const submit = await runSubmitTask(ctx, {
				objective: "x",
				agent_kind: "claude-code",
				cwd: "/tmp",
				adapter_options: { cleanup_on_terminal_report: true },
			});
			if (!submit.accepted) throw new Error("setup failed");
			updateTaskChildTokenHash(
				db,
				submit.task_id,
				"sha256:3a6eb0790f39ac87c94f3856b2dd2c5d110e6811602261a9a923d3bb23adc8b7",
			);
			const sessionName = `cuekit-task-${submit.task_id}`;
			expect(runner.knownSessions()).toContain(sessionName);

			const result = await runReportTaskEvent(ctx, {
				task_id: submit.task_id,
				child_token: "data",
				type: reportType,
				message: `${reportType} reported`,
			});

			expect(result.ok).toBe(true);
			expect(getTaskById(db, submit.task_id)?.status).toBe(reportType);
			expect(runner.knownSessions()).not.toContain(sessionName);
		}
	});

	it("does not run cleanup for non-terminal reports", async () => {
		const submit = await runSubmitTask(ctx, {
			objective: "x",
			agent_kind: "claude-code",
			cwd: "/tmp",
			adapter_options: { cleanup_on_terminal_report: true },
		});
		if (!submit.accepted) throw new Error("setup failed");
		updateTaskChildTokenHash(
			db,
			submit.task_id,
			"sha256:3a6eb0790f39ac87c94f3856b2dd2c5d110e6811602261a9a923d3bb23adc8b7",
		);
		const sessionName = `cuekit-task-${submit.task_id}`;

		const result = await runReportTaskEvent(ctx, {
			task_id: submit.task_id,
			child_token: "data",
			type: "progress",
			message: "still working",
		});

		expect(result.ok).toBe(true);
		expect(getTaskById(db, submit.task_id)?.status).toBe("running");
		expect(runner.knownSessions()).toContain(sessionName);
	});

	it("succeeds with terminal status committed even when post-report cleanup fails", async () => {
		const submit = await runSubmitTask(ctx, {
			objective: "x",
			agent_kind: "claude-code",
			cwd: "/tmp",
			adapter_options: { cleanup_on_terminal_report: true },
		});
		if (!submit.accepted) throw new Error("setup failed");
		updateTaskChildTokenHash(
			db,
			submit.task_id,
			"sha256:3a6eb0790f39ac87c94f3856b2dd2c5d110e6811602261a9a923d3bb23adc8b7",
		);
		// Force the next tmux call (kill-session via cleanup) to fail.
		runner.queueResponse({ stdout: "", stderr: "permission denied", exitCode: 1 });

		const result = await runReportTaskEvent(ctx, {
			task_id: submit.task_id,
			child_token: "data",
			type: "completed",
			message: "Done",
		});

		// The terminal status MUST commit regardless of cleanup outcome.
		expect(result.ok).toBe(true);
		expect(getTaskById(db, submit.task_id)?.status).toBe("completed");
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

describe("wait safety bounds", () => {
	it("caps grouped MCP wait timeout values before dispatch", () => {
		const bounded = applyMcpWaitSafetyBounds(ctx, {
			kind: "tasks",
			task_ids: ["t_1"],
			timeout_ms: MCP_SAFE_WAIT_TIMEOUT_MS + 1,
		});

		expect(bounded.timeout_ms).toBe(MCP_SAFE_WAIT_TIMEOUT_MS);
	});

	it("keeps short grouped MCP wait timeout values unchanged", () => {
		const bounded = applyMcpWaitSafetyBounds(ctx, {
			kind: "tasks",
			task_ids: ["t_1"],
			timeout_ms: 1000,
		});

		expect(bounded.timeout_ms).toBe(1000);
	});

	it("sets a safe grouped MCP wait timeout when omitted", () => {
		const bounded = applyMcpWaitSafetyBounds(ctx, {
			kind: "team",
			team_id: "tm_1",
		});

		expect(bounded.timeout_ms).toBe(MCP_SAFE_WAIT_TIMEOUT_MS);
	});

	it("preserves shorter project-config team wait defaults", () => {
		const root = mkdtempSync(join(tmpdir(), "cuekit-mcp-wait-bounds-"));
		try {
			writeFileSync(join(root, ".cuekit.yaml"), "teams:\n  wait:\n    timeout_ms: 0\n");
			createSession(db, {
				id: "s_mcp_wait_bounds",
				project_root: root,
				worktree_path: root,
				parent_agent_kind: "pi",
			});
			createTaskTeam(db, {
				id: "tm_mcp_wait_bounds",
				session_id: "s_mcp_wait_bounds",
				title: "Team",
			});

			const bounded = applyMcpWaitSafetyBounds(ctx, {
				kind: "team",
				team_id: "tm_mcp_wait_bounds",
			});

			expect(bounded.timeout_ms).toBeUndefined();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("wait-tasks", () => {
	it("rejects duplicate task ids", async () => {
		const waited = await runWaitTasks(ctx, {
			task_ids: ["t_dup", "t_dup"],
			timeout_ms: 0,
		});

		expect(waited.done).toBe(false);
		expect(waited.error?.code).toBe("invalid_input");
		expect(waited.error?.message).toBe("duplicate task_id 't_dup'");
	});

	it("accepts a comma-separated task_ids string", async () => {
		const a = await runSubmitTask(ctx, {
			objective: "a",
			agent_kind: "claude-code",
			cwd: "/my/project",
		});
		const b = await runSubmitTask(ctx, {
			objective: "b",
			agent_kind: "claude-code",
			cwd: "/my/project",
		});
		if (!a.accepted || !b.accepted) throw new Error("setup failed");

		const waited = await runWaitTasks(ctx, {
			task_ids: [`${a.task_id},${b.task_id}`],
			session_id: a.session_id,
			timeout_ms: 0,
			poll_interval_ms: 1,
		});

		expect(waited.error).toBeUndefined();
		expect(waited.tasks.map((t) => t.task_id)).toEqual([a.task_id, b.task_id]);
	});

	it("succeeds when cwd is omitted even if process.cwd() is unrelated to the task's worktree", async () => {
		const submitted = await runSubmitTask(ctx, {
			objective: "x",
			agent_kind: "claude-code",
			cwd: "/some/distant/worktree",
		});
		if (!submitted.accepted) throw new Error("setup failed");

		// Sanity: process.cwd() is NOT the task's worktree. Without the opt-in
		// fix, this would return permission_denied.
		expect(process.cwd()).not.toBe("/some/distant/worktree");

		const waited = await runWaitTasks(ctx, {
			task_ids: [submitted.task_id],
			timeout_ms: 0,
			poll_interval_ms: 1,
		});

		expect(waited.error).toBeUndefined();
		expect(waited.scope.cwd).toBeUndefined();
		expect(waited.tasks).toHaveLength(1);
		expect(waited.tasks[0]?.task_id).toBe(submitted.task_id);
	});

	it("still rejects with permission_denied when cwd is explicitly mismatched", async () => {
		const submitted = await runSubmitTask(ctx, {
			objective: "x",
			agent_kind: "claude-code",
			cwd: "/correct/worktree",
		});
		if (!submitted.accepted) throw new Error("setup failed");

		const waited = await runWaitTasks(ctx, {
			task_ids: [submitted.task_id],
			cwd: "/wrong/worktree",
			timeout_ms: 0,
			poll_interval_ms: 1,
		});

		expect(waited.done).toBe(false);
		expect(waited.error?.code).toBe("permission_denied");
		expect(waited.error?.message).toMatch(/outside cwd/);
	});

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
		expect(waited.next_action_hint).toContain("poll again");
		expect(waited.cleanup_hint).toBeUndefined();
		expect(waited.tasks).toHaveLength(1);
		expect(waited.tasks[0]?.status).toBe("running");
		expect(getTaskById(db, submitted.task_id)?.status).toBe("running");
	});

	it("timeout hint recommends steering when a task has no recent activity", async () => {
		const submitted = await runSubmitTask(ctx, {
			objective: "x",
			agent_kind: "claude-code",
			cwd: "/my/project",
		});
		if (!submitted.accepted) throw new Error("setup failed");
		db.prepare("update tasks set updated_at = ?, started_at = ? where id = ?").run(
			"2026-01-01T00:00:00.000Z",
			"2026-01-01T00:00:00.000Z",
			submitted.task_id,
		);

		const waited = await runWaitTasks(ctx, {
			task_ids: [submitted.task_id],
			session_id: submitted.session_id,
			timeout_ms: 0,
			poll_interval_ms: 1,
		});

		expect(waited.tasks[0]?.attention_hint).toBe("no_recent_activity");
		expect(waited.next_action_hint).toContain("poll again");
		expect(waited.next_action_hint).toContain("cuekit_steer");
		expect(waited.next_action_hint).toContain("progress or terminal report");
	});

	it("timeout hint prioritizes prompt or stop-hook attention", async () => {
		const root = mkdtempSync(join(tmpdir(), "cuekit-stop-hook-hint-"));
		try {
			const transcript = join(root, "transcript.txt");
			writeFileSync(transcript, "idle-prompt");
			const submitted = await runSubmitTask(ctx, {
				objective: "x",
				agent_kind: "claude-code",
				cwd: root,
			});
			if (!submitted.accepted) throw new Error("setup failed");
			db.prepare("update tasks set transcript_ref = ? where id = ?").run(
				transcript,
				submitted.task_id,
			);

			const waited = await runWaitTasks(ctx, {
				task_ids: [submitted.task_id],
				session_id: submitted.session_id,
				timeout_ms: 0,
				poll_interval_ms: 1,
			});

			expect(waited.tasks[0]?.attention_hint).toBe("stop_hook_or_idle_prompt_suspected");
			expect(waited.next_action_hint).toContain("poll again");
			expect(waited.next_action_hint).toContain("prompt or stop hook");
			expect(waited.next_action_hint).toContain("cuekit_steer");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("timeout hint notes recent activity without attention hints", async () => {
		const submitted = await runSubmitTask(ctx, {
			objective: "x",
			agent_kind: "claude-code",
			cwd: "/my/project",
		});
		if (!submitted.accepted) throw new Error("setup failed");
		appendTaskEvent(db, {
			id: "e_recent_activity_hint",
			task_id: submitted.task_id,
			type: "log",
			message: "still working",
		});

		const waited = await runWaitTasks(ctx, {
			task_ids: [submitted.task_id],
			session_id: submitted.session_id,
			timeout_ms: 0,
			poll_interval_ms: 1,
		});

		expect(waited.next_action_hint).toContain("poll again");
		expect(waited.next_action_hint).toContain("Recent activity was observed");
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
		expect(waited.cleanup_hint).toContain(submitted.task_id);
		expect(waited.cleanup_hint).toContain("cuekit_delete");
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

	it("uses terminal child report message as inline result summary fallback", async () => {
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
			message: "inline wait summary",
		});

		const wait = await runWaitTasks(ctx, {
			task_ids: [submit.task_id],
			session_id: submit.session_id,
			timeout_ms: 0,
		});

		expect(wait.done).toBe(true);
		expect(wait.tasks[0]?.result?.summary).toBe("inline wait summary");
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

	it("delivers a handoff message from inline text", async () => {
		const submit = await runSubmitTask(ctx, {
			objective: "x",
			agent_kind: "claude-code",
			cwd: "/tmp",
		});
		if (!submit.accepted) throw new Error("setup failed");
		const before = runner.calls.length;
		const ack = await runSteerTask(ctx, {
			task_id: submit.task_id,
			event_type: "handoff",
			message: "# HANDOFF\nContinue from here.",
		});
		expect(ack.ok).toBe(true);
		const sendCalls = runner.calls.slice(before).filter((c) => c[0] === "send-keys");
		expect(sendCalls[0]?.join(" ")).toContain("[HANDOFF]");
		expect(sendCalls[0]?.join(" ")).toContain("Continue from here.");
		const events = listTaskEvents(db, submit.task_id);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({ type: "handoff", task_id: submit.task_id });
		expect(events[0]?.payload).toEqual({
			artifact_path: expect.stringContaining(`.cuekit/tasks/${submit.task_id}/handoffs/`),
		});
	});

	it("delivers a handoff message from message_file", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cuekit-handoff-"));
		try {
			const file = join(dir, "HANDOFF.md");
			writeFileSync(file, "# HANDOFF\nFrom file.");
			const submit = await runSubmitTask(ctx, {
				objective: "x",
				agent_kind: "claude-code",
				cwd: "/tmp",
			});
			if (!submit.accepted) throw new Error("setup failed");
			const before = runner.calls.length;
			const ack = await runSteerTask(ctx, {
				task_id: submit.task_id,
				event_type: "handoff",
				message_file: file,
			});
			expect(ack.ok).toBe(true);
			const sendCalls = runner.calls.slice(before).filter((c) => c[0] === "send-keys");
			expect(sendCalls[0]?.join(" ")).toContain("[HANDOFF]");
			expect(sendCalls[0]?.join(" ")).toContain("From file.");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("does not record handoff events when injection fails", async () => {
		const submit = await runSubmitTask(ctx, {
			objective: "x",
			agent_kind: "claude-code",
			cwd: "/tmp",
			adapter_options: { mode: "batch" },
		});
		if (!submit.accepted) throw new Error("setup failed");
		const ack = await runSteerTask(ctx, {
			task_id: submit.task_id,
			event_type: "handoff",
			message: "# HANDOFF\nWill not inject.",
		});
		expect(ack.ok).toBe(false);
		if (!ack.ok) expect(ack.error.code).toBe("steering_unsupported");
		expect(listTaskEvents(db, submit.task_id)).toEqual([]);
	});

	it("rejects empty message_file content", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cuekit-handoff-empty-"));
		try {
			const file = join(dir, "HANDOFF.md");
			writeFileSync(file, "   ");
			const submit = await runSubmitTask(ctx, {
				objective: "x",
				agent_kind: "claude-code",
				cwd: "/tmp",
			});
			if (!submit.accepted) throw new Error("setup failed");
			const ack = await runSteerTask(ctx, {
				task_id: submit.task_id,
				event_type: "handoff",
				message_file: file,
			});
			expect(ack.ok).toBe(false);
			if (!ack.ok) expect(ack.error.code).toBe("invalid_input");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("rejects actor/source fields for handoff provenance", () => {
		expect(
			SteerTaskInputSchema.safeParse({
				task_id: "t1",
				event_type: "handoff",
				message: "# HANDOFF",
				actor: "hermes",
			}).success,
		).toBe(false);
		expect(
			SteerTaskInputSchema.safeParse({
				task_id: "t1",
				event_type: "handoff",
				message: "# HANDOFF",
				source: "hermes",
			}).success,
		).toBe(false);
	});

	it("validates grouped steer task handoff message fields", () => {
		const steer = CUEKIT_MCP_OPERATIONS.find((operation) => operation.mcpName === "steer");
		if (!steer) throw new Error("missing steer operation");
		expect(
			steer.options.safeParse({ kind: "task", task_id: "t1", message: "a" }).success,
		).toBe(true);
		expect(
			steer.options.safeParse({ kind: "task", task_id: "t1", message_file: "HANDOFF.md" })
				.success,
		).toBe(true);
		expect(
			steer.options.safeParse({ kind: "task", task_id: "t1", message: "a", message_file: "b" })
				.success,
		).toBe(false);
		expect(steer.options.safeParse({ kind: "task", task_id: "t1" }).success).toBe(false);
		expect(
			steer.options.safeParse({ kind: "team", team_id: "tm_1", message: "a", message_file: "b" })
				.success,
		).toBe(false);
		expect(
			steer.options.safeParse({ kind: "team", team_id: "tm_1", message: "a", event_type: "handoff" })
				.success,
		).toBe(false);
	});

	it("returns task_not_found for unknown id", async () => {
		const ack = await runSteerTask(ctx, { task_id: "t_nope", message: "..." });
		expect(ack.ok).toBe(false);
	});
});

describe("steer-team", () => {
	it("steers every non-terminal task in a team and skips terminal tasks", async () => {
		createSession(db, {
			id: "s_team_steer",
			project_root: "/p",
			worktree_path: "/w",
			parent_agent_kind: "pi",
		});
		createTaskTeam(db, { id: "tm_steer", session_id: "s_team_steer", title: "Team" });

		const active = await runSubmitTask(ctx, {
			objective: "active",
			agent_kind: "claude-code",
			session_id: "s_team_steer",
			team_id: "tm_steer",
		});
		const needsInput = await runSubmitTask(ctx, {
			objective: "needs input",
			agent_kind: "claude-code",
			session_id: "s_team_steer",
			team_id: "tm_steer",
		});
		const terminal = createTask(db, {
			id: "t_terminal",
			session_id: "s_team_steer",
			team_id: "tm_steer",
			agent_kind: "claude-code",
			objective: "done",
			status: "completed",
			spec: { objective: "done", agent_kind: "claude-code" },
		});
		if (!active.accepted || !needsInput.accepted) throw new Error("setup failed");
		// Simulate a non-terminal task that still accepts steering.
		db.query("update tasks set status = 'input_required' where id = ?").run(needsInput.task_id);

		const before = runner.calls.length;
		const ack = await runSteerTeam(ctx, {
			team_id: "tm_steer",
			message: "Please converge on the new team-level steer behavior.",
		});

		expect(ack.ok).toBe(true);
		if (!ack.ok) throw new Error("expected team steer to succeed");
		expect(ack.team_id).toBe("tm_steer");
		expect(ack.steered.map((item) => item.task_id).sort()).toEqual(
			[active.task_id, needsInput.task_id].sort(),
		);
		expect(ack.skipped).toEqual([
			{ task_id: terminal.id, status: "completed", reason: "terminal" },
		]);
		expect(ack.failed).toEqual([]);
		const sendCalls = runner.calls.slice(before).filter((c) => c[0] === "send-keys");
		expect(sendCalls).toHaveLength(4);
	});

	it("returns team_not_found for unknown team", async () => {
		const ack = await runSteerTeam(ctx, { team_id: "tm_nope", message: "..." });
		expect(ack.ok).toBe(false);
		if (ack.ok) throw new Error("expected team steer to fail");
		expect(ack.error.code).toBe("team_not_found");
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

	it("can skip live status refresh for high-frequency UI task lists", async () => {
		await runSubmitTask(ctx, {
			objective: "a",
			agent_kind: "claude-code",
			cwd: "/tmp/one",
			timeout_ms: 1,
		});
		await Bun.sleep(5);

		const result = await runListTasks(ctx, { status: "running", refresh_status: false });

		if ("error" in result) throw new Error(result.error.message);
		expect(result.tasks).toHaveLength(1);
		expect(result.tasks[0]?.status).toBe("running");
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
		const task = createTask(db, {
			id: "t_relative",
			session_id: "s_relative",
			agent_kind: "claude-code",
			objective: "legacy task",
			status: "running",
		});
		const result = await runListTasks(ctx, { cwd: "legacy/relative" });
		if ("error" in result) throw new Error(result.error.message);
		expect(result.tasks.map((t) => t.task_id)).toContain(task.id);
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
		expect(pi?.supports_model_selection).toBe(true);
		expect(pi?.available_models).toBeUndefined();
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

	it("accepts a comma-separated task_ids string", async () => {
		const a = await runSubmitTask(ctx, { objective: "a", agent_kind: "claude-code", cwd: "/tmp" });
		const b = await runSubmitTask(ctx, { objective: "b", agent_kind: "claude-code", cwd: "/tmp" });
		if (!a.accepted || !b.accepted) throw new Error("setup failed");
		await runCancelTasks(ctx, { task_ids: [`${a.task_id},${b.task_id}`] });

		const ack = await runDeleteTasks(ctx, { task_ids: [`${a.task_id},${b.task_id}`] });

		expect(ack.ok).toBe(true);
		if (ack.ok) expect(ack.tasks.map((t) => t.task_id)).toEqual([a.task_id, b.task_id]);
		expect(getTaskById(db, a.task_id)).toBeNull();
		expect(getTaskById(db, b.task_id)).toBeNull();
	});

	it("rejects task_ids that resolve to an empty list after splitting", async () => {
		const ack = await runDeleteTasks(ctx, { task_ids: [","] });
		expect(ack.ok).toBe(false);
		if (!ack.ok) {
			expect(ack.error.code).toBe("invalid_input");
			expect(ack.error.message).toMatch(/empty values after splitting/);
		}
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

	it("returns a structured error when adapter cleanup fails", async () => {
		const submit = await runSubmitTask(ctx, {
			objective: "x",
			agent_kind: "claude-code",
			cwd: "/tmp",
		});
		if (!submit.accepted) throw new Error("setup failed");
		await runCancelTasks(ctx, { task_ids: [submit.task_id] });
		runner.queueResponse({ stdout: "", stderr: "permission denied", exitCode: 1 });

		const ack = await runCleanupTasks(ctx, { session_id: submit.session_id });

		expect(ack.ok).toBe(false);
		if (!ack.ok) {
			expect(ack.error.code).toBe("runtime_crash");
			expect(ack.error.message).toContain(submit.task_id);
		}
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

	it("accepts a comma-separated session_ids string", async () => {
		createSession(db, {
			id: "s_comma_a",
			project_root: "/p",
			worktree_path: "/w",
			parent_agent_kind: "pi",
		});
		createSession(db, {
			id: "s_comma_b",
			project_root: "/p",
			worktree_path: "/w",
			parent_agent_kind: "pi",
		});

		const ack = await runDeleteSessions(ctx, {
			session_ids: ["s_comma_a,s_comma_b"],
		});

		expect(ack.ok).toBe(true);
		if (ack.ok) expect(ack.sessions.map((s) => s.session_id)).toEqual(["s_comma_a", "s_comma_b"]);
		expect(getSessionById(db, "s_comma_a")).toBeNull();
		expect(getSessionById(db, "s_comma_b")).toBeNull();
	});
});

describe("list-agent-profiles", () => {
	it("lists builtin profiles without instructions by default", () => {
		const result = runListAgentProfiles(ctx, {});
		expect("profiles" in result).toBe(true);
		if (!("profiles" in result)) return;
		expect(result.profiles.map((profile) => profile.id)).toContain("worker");
		expect(
			result.profiles.find((profile) => profile.id === "worker")?.instructions,
		).toBeUndefined();
	});

	it("uses session worktree for project discovery", () => {
		const root = mkdtempSync(join(tmpdir(), "cuekit-mcp-profiles-"));
		try {
			mkdirSync(join(root, ".git"));
			mkdirSync(join(root, ".cuekit", "agents"), { recursive: true });
			writeFileSync(
				join(root, ".cuekit", "agents", "reviewer.md"),
				"---\nid: reviewer\nmodel: opus\n---",
			);
			createSession(db, {
				id: "s_profiles",
				project_root: root,
				worktree_path: root,
				parent_agent_kind: "pi",
			});
			const result = runListAgentProfiles(ctx, { session_id: "s_profiles" });
			expect("profiles" in result).toBe(true);
			if (!("profiles" in result)) return;
			expect(result.profiles.find((profile) => profile.id === "reviewer")?.model).toBe("opus");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("returns session_not_found for unknown sessions", () => {
		const result = runListAgentProfiles(ctx, { session_id: "missing" });
		expect("error" in result).toBe(true);
		if ("error" in result) expect(result.error.code).toBe("session_not_found");
	});

	it("returns invalid_input for malformed project profiles", () => {
		const root = mkdtempSync(join(tmpdir(), "cuekit-mcp-profiles-"));
		try {
			mkdirSync(join(root, ".git"));
			mkdirSync(join(root, ".cuekit", "agents"), { recursive: true });
			writeFileSync(join(root, ".cuekit", "agents", "broken.md"), "---\nid: broken");
			const result = runListAgentProfiles(ctx, { cwd: root });
			expect("error" in result).toBe(true);
			if ("error" in result) expect(result.error.code).toBe("invalid_input");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
