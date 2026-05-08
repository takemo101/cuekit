import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TaskStatusView } from "@cuekit/core";
import {
	appendTaskEvent,
	createSession,
	createTask,
	createTaskTeam,
	getTaskById,
	getTaskTeamById,
	listTaskEvents,
	listTasks,
	listTaskTeams,
	runMigrations,
	updateTaskChildTokenHash,
	updateTaskRefs,
} from "@cuekit/store";
import type { TuiContext } from "../src/context.ts";
import {
	captureLivePaneTail,
	loadTaskDetail,
	loadTaskList,
	loadTeamDetail,
	loadTeamList,
	readTranscriptTail,
	resolveTranscriptTail,
	sanitizeTerminalText,
} from "../src/data.ts";

function makeCtx(): { db: Database; tui: TuiContext } {
	const db = new Database(":memory:");
	db.exec("pragma foreign_keys = ON;");
	runMigrations(db);
	const tui: TuiContext = {
		async listTasks(input) {
			return {
				tasks: listTasks(db, input).map((task) => ({
					task_id: task.id,
					agent_kind: task.agent_kind,
					status: task.status,
					summary: task.summary ?? undefined,
					updated_at: task.updated_at,
				})),
				has_more: false,
			};
		},
		async getTaskStatus(taskId) {
			const task = getTaskById(db, taskId);
			if (!task) {
				return {
					task_id: taskId,
					status: "failed",
					error: {
						code: "task_not_found",
						message: `task '${taskId}' not found`,
						retryable: false,
					},
				};
			}
			return {
				task_id: task.id,
				agent_kind: task.agent_kind,
				status: task.status,
				created_at: task.created_at,
				updated_at: task.updated_at,
			} satisfies TaskStatusView;
		},
		async listTaskEvents(taskId) {
			if (!getTaskById(db, taskId)) {
				return {
					error: {
						code: "task_not_found",
						message: `task '${taskId}' not found`,
						retryable: false,
					},
				};
			}
			return { events: listTaskEvents(db, taskId) };
		},
		async cancelTask() {
			return { ok: true };
		},
		async deleteTask() {
			return { ok: true };
		},
		async steerTask() {
			return { ok: true };
		},
		getTranscriptPath(taskId) {
			return getTaskById(db, taskId)?.transcript_ref ?? undefined;
		},
	};
	return { db, tui };
}

function createTestTask(db: Database) {
	createSession(db, {
		id: "s_tui_data",
		project_root: "/tmp/cuekit-tui-data",
		worktree_path: "/tmp/cuekit-tui-data",
		parent_agent_kind: "cli",
	});
	return createTask(db, {
		id: "t_tui_data",
		session_id: "s_tui_data",
		agent_kind: "claude-code",
		objective: "x",
		status: "running",
	});
}

describe("tui data helpers", () => {
	it("loads an empty task list", async () => {
		const { tui } = makeCtx();
		const list = await loadTaskList(tui, { limit: 100 });

		expect("tasks" in list).toBe(true);
		if ("tasks" in list) {
			expect(list.tasks).toEqual([]);
			expect(list.has_more).toBe(false);
		}
	});

	it("loads submitted tasks for the cockpit list", async () => {
		const { db, tui } = makeCtx();
		const task = createTestTask(db);

		const list = await loadTaskList(tui, { limit: 100 });

		expect("tasks" in list).toBe(true);
		if ("tasks" in list) {
			expect(list.tasks.map((item) => item.task_id)).toContain(task.id);
		}
	});

	it("loads selected task status and events", async () => {
		const { db, tui } = makeCtx();
		const task = createTestTask(db);
		updateTaskChildTokenHash(
			db,
			task.id,
			"sha256:3a6eb0790f39ac87c94f3856b2dd2c5d110e6811602261a9a923d3bb23adc8b7",
		);
		appendTaskEvent(db, {
			id: "e_halfway",
			task_id: task.id,
			type: "progress",
			message: "halfway",
			payload: null,
		});

		const detail = await loadTaskDetail(tui, task.id);

		expect(detail.status.task_id).toBe(task.id);
		expect(detail.events).toHaveLength(1);
		expect(detail.events[0]?.message).toBe("halfway");
	});

	it("loads team attention items for selected team tasks when team status is available", async () => {
		const { db, tui } = makeCtx();
		createSession(db, {
			id: "s_team_attention",
			project_root: "/tmp/cuekit-tui-data",
			worktree_path: "/tmp/cuekit-tui-data",
			parent_agent_kind: "cli",
		});
		createTaskTeam(db, { id: "tm_1", session_id: "s_team_attention", title: "Team" });
		const task = createTask(db, {
			id: "t_team_attention",
			session_id: "s_team_attention",
			agent_kind: "pi",
			team_id: "tm_1",
			team_position: "coordinator",
			objective: "coordinate",
			status: "running",
		});
		const teamCtx: TuiContext = {
			...tui,
			async getTaskStatus(taskId) {
				const status = await tui.getTaskStatus(taskId);
				return { ...status, team_id: "tm_1", position: "coordinator" };
			},
			async getTeamStatus(teamId) {
				return {
					team_id: teamId,
					run_summary: {
						attention_items: [
							{
								sequence: 1,
								task_id: "t_worker",
								position: "worker",
								type: "help_requested",
								message_preview: "need input",
								created_at: "2026-05-01T00:00:00.000Z",
							},
						],
						manual_steer_hints: [
							{
								attention_sequence: 1,
								task_id: "t_worker",
								position: "worker",
								tool: "steer_task",
								suggested_message: "Please clarify",
								rationale: "Manual helper only",
							},
						],
					},
				};
			},
		};

		const detail = await loadTaskDetail(teamCtx, task.id);

		expect(detail.teamAttentionItems?.[0]?.message_preview).toBe("need input");
		expect(detail.manualSteerHints?.[0]?.tool).toBe("steer_task");
	});

	it("loads teams and groups selected team members by lane", async () => {
		const { db, tui } = makeCtx();
		createSession(db, {
			id: "s_team_list",
			project_root: "/tmp/cuekit-tui-data",
			worktree_path: "/tmp/cuekit-tui-data",
			parent_agent_kind: "cli",
		});
		createTaskTeam(db, { id: "tm_tui", session_id: "s_team_list", title: "TUI Team" });
		for (const [id, position] of [
			["t_coord", "coordinator"],
			["t_worker", "worker"],
			["t_review", "reviewer"],
			["t_finish", "finisher"],
			["t_unpositioned", undefined],
		] as const) {
			createTask(db, {
				id,
				session_id: "s_team_list",
				agent_kind: "pi",
				team_id: "tm_tui",
				...(position ? { team_position: position } : {}),
				objective: id,
				status: "running",
			});
		}
		const teamCtx: TuiContext = {
			...tui,
			async listTeams() {
				return {
					teams: listTaskTeams(db, { limit: 100 }).map((team) => ({
						team_id: team.id,
						session_id: team.session_id,
						title: team.title,
						status: "running",
						task_counts: {
							total: 5,
							queued: 0,
							running: 5,
							input_required: 0,
							completed: 0,
							failed: 0,
							cancelled: 0,
							timed_out: 0,
							blocked: 0,
						},
						created_at: team.created_at,
						updated_at: team.updated_at,
					})),
					has_more: false,
				};
			},
			async getTeamStatus(teamId) {
				const team = getTaskTeamById(db, teamId);
				if (!team)
					return { error: { code: "team_not_found", message: "missing", retryable: false } };
				const tasks = listTasks(db, { team_id: teamId, limit: 100 }).map((task) => ({
					task_id: task.id,
					agent_kind: task.agent_kind,
					...(task.team_id ? { team_id: task.team_id } : {}),
					...(task.team_position ? { position: task.team_position as never } : {}),
					status: task.status,
					updated_at: task.updated_at,
				}));
				return {
					team_id: team.id,
					session_id: team.session_id,
					title: team.title,
					status: "running",
					tasks,
					run_summary: {
						attention_items: [
							{
								sequence: 2,
								task_id: "t_review",
								position: "reviewer",
								type: "completed",
								message_preview: "needs polish",
								created_at: "2026-05-01T00:00:00.000Z",
							},
						],
					},
				};
			},
		};

		const list = await loadTeamList(teamCtx, { limit: 100 });
		expect("teams" in list).toBe(true);
		if (!("teams" in list)) throw new Error("expected teams");
		expect(list.teams.map((team) => team.team_id)).toEqual(["tm_tui"]);

		const team = list.teams[0];
		expect(team).toBeDefined();
		if (!team) throw new Error("expected team");
		const detail = await loadTeamDetail(teamCtx, team);
		expect(detail.lanes.coordinator?.map((task) => task.task_id)).toEqual(["t_coord"]);
		expect(detail.lanes.worker?.map((task) => task.task_id)).toEqual(["t_worker"]);
		expect(detail.lanes.reviewer?.map((task) => task.task_id)).toEqual(["t_review"]);
		expect(detail.lanes.finisher?.map((task) => task.task_id)).toEqual(["t_finish"]);
		expect(detail.lanes.unpositioned?.map((task) => task.task_id)).toEqual(["t_unpositioned"]);
		expect(detail.attentionItems?.[0]?.message_preview).toBe("needs polish");
	});

	it("keeps team summary when selected team status loading fails", async () => {
		const { tui } = makeCtx();
		const teamCtx: TuiContext = {
			...tui,
			async getTeamStatus() {
				return { error: { code: "team_not_found", message: "missing team", retryable: false } };
			},
		};
		const detail = await loadTeamDetail(teamCtx, {
			team_id: "tm_missing",
			session_id: "s_missing",
			title: "Missing",
			status: "failed",
			task_counts: {
				total: 0,
				queued: 0,
				running: 0,
				input_required: 0,
				completed: 0,
				failed: 0,
				cancelled: 0,
				timed_out: 0,
				blocked: 0,
			},
			created_at: "2026-05-01T00:00:00.000Z",
			updated_at: "2026-05-01T00:00:00.000Z",
		});

		expect(detail.team.team_id).toBe("tm_missing");
		expect(detail.error).toBe("missing team");
		expect(detail.members).toEqual([]);
	});

	it("keeps status and transcript data when task event loading fails", async () => {
		const { db, tui } = makeCtx();
		const task = createTestTask(db);
		const failingCtx: TuiContext = {
			...tui,
			async listTaskEvents() {
				return {
					error: {
						code: "task_not_found",
						message: "event load failed",
						retryable: false,
					},
				};
			},
		};

		const detail = await loadTaskDetail(failingCtx, task.id);

		expect(detail.status.task_id).toBe(task.id);
		expect(detail.events).toEqual([]);
		expect(detail.eventsError).toBe("event load failed");
	});

	it("strips terminal control sequences from transcript text", () => {
		expect(sanitizeTerminalText("\u001b[31mred\u001b[0m\r\u001b]0;title\u0007 text")).toBe(
			"red text",
		);
	});

	it("strips DCS and application passthrough sequences from transcript text", () => {
		expect(
			sanitizeTerminalText("before\u001bPtmux;\u001b_Gi=31337;AAAA\u001b\\\u001b\\after"),
		).toBe("beforeafter");
		expect(sanitizeTerminalText("before\u001b_Gi=31337,s=1;AAAA\u001b\\after")).toBe("beforeafter");
		expect(sanitizeTerminalText("before\u001bPtmux;\u0007LEAK\u001b\\after")).toBe("beforeafter");
	});

	it("strips DEL and C1 terminal control bytes from transcript text", () => {
		expect(sanitizeTerminalText("\u009b31mred\u009dtitle\u007f text")).toBe("31mredtitle text");
	});

	it("cleans OpenCode TUI repaint fragments from transcript text", () => {
		expect(
			sanitizeTerminalText(
				'[?25l⬝⬝■■┃ # Reports completed $ cuekit tool report --type completed --message "ok" opencode■■ adapter smoke ok · 1m 47s',
			),
		).toBe(
			' # Reports completed $ cuekit tool report --type completed --message "ok" opencode adapter smoke ok · 1m 47s',
		);
	});

	it("does not strip ordinary bracketed text or spacing while cleaning bare cursor fragments", () => {
		expect(sanitizeTerminalText("Option [A] and [docs](url) [?25l done")).toBe(
			"Option [A] and [docs](url)  done",
		);
	});

	it("filters common Claude UI and cuekit prompt contract noise from transcript tails", () => {
		const dir = mkdtempSync(`${tmpdir()}/cuekit-tui-transcript-noise-`);
		try {
			const path = join(dir, "transcript.txt");
			writeFileSync(
				path,
				[
					"Ran 3 stop hooks (ctrl+o to expand)",
					"Stop hook prevented continuation",
					"⏵⏵ bypass permissions on (shift+tab to cycle)",
					"- If MCP is unavailable, use the CLI fallback: cuekit tool report --type <progress|completed>",
					"- CUEKIT_TASK_ID and CUEKIT_CHILD_TOKEN are already provided in your environment; do not print",
					"Useful final summary",
				].join("\n"),
			);

			expect(readTranscriptTail(path, 10)).toEqual(["Useful final summary"]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("keeps useful non-contract transcript lines that mention filtered phrases", () => {
		const dir = mkdtempSync(`${tmpdir()}/cuekit-tui-transcript-noise-`);
		try {
			const path = join(dir, "transcript.txt");
			writeFileSync(
				path,
				[
					"Investigation note: if MCP is unavailable, check the server logs.",
					"I fixed the stop hook prevented continuation bug.",
				].join("\n"),
			);

			expect(readTranscriptTail(path, 10)).toEqual([
				"Investigation note: if MCP is unavailable, check the server logs.",
				"I fixed the stop hook prevented continuation bug.",
			]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("filters punctuation-only terminal spinner fragments from transcript tails", () => {
		const dir = mkdtempSync(`${tmpdir()}/cuekit-tui-transcript-noise-`);
		try {
			const path = join(dir, "transcript.txt");
			writeFileSync(path, "+\n*\nn\n'g\nalmost done thinking\n✓ completed\n");

			expect(readTranscriptTail(path, 10)).toEqual([
				"n",
				"'g",
				"almost done thinking",
				"✓ completed",
			]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("reads the last N transcript lines", () => {
		const dir = mkdtempSync(`${tmpdir()}/cuekit-tui-transcript-`);
		try {
			const path = join(dir, "transcript.txt");
			writeFileSync(path, "one\ntwo\nthree\nfour\n");

			expect(readTranscriptTail(path, 2)).toEqual(["three", "four"]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("tolerates missing transcript files", () => {
		expect(readTranscriptTail("/definitely/missing/transcript.txt", 10)).toEqual([]);
		expect(readTranscriptTail(undefined, 10)).toEqual([]);
	});

	it("loads transcript tail from selected task transcript_ref when present", async () => {
		const { db, tui } = makeCtx();
		const task = createTestTask(db);
		const dir = mkdtempSync(`${tmpdir()}/cuekit-tui-transcript-ref-`);
		try {
			mkdirSync(join(dir, "nested"));
			const transcriptPath = join(dir, "nested", "transcript.txt");
			writeFileSync(transcriptPath, "alpha\nbeta\ngamma\n");
			updateTaskRefs(db, task.id, { transcript_ref: transcriptPath });

			const detail = await loadTaskDetail(tui, task.id, { transcriptLines: 2 });

			expect(detail.transcriptPath).toBe(transcriptPath);
			expect(detail.transcriptTail).toEqual(["beta", "gamma"]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	describe("captureLivePaneTail", () => {
		it("returns null when tmux is missing or the session does not exist", async () => {
			const out = await captureLivePaneTail("cuekit-task-bogus", 10, {
				tmuxBin: "/var/empty/this-tmux-does-not-exist",
			});
			expect(out).toBeNull();
		});
	});

	describe("resolveTranscriptTail", () => {
		function statusFor(overrides: Partial<TaskStatusView>): TaskStatusView {
			return {
				task_id: "t_abc",
				status: "running",
				...overrides,
			};
		}

		it("falls back to file tail when the task is terminal", async () => {
			const dir = mkdtempSync(`${tmpdir()}/cuekit-resolve-terminal-`);
			try {
				const transcriptPath = join(dir, "transcript.txt");
				writeFileSync(transcriptPath, "first\nsecond\nthird\n");
				const status = statusFor({
					status: "completed",
					metadata: { tmux_session_name: "cuekit-task-t_abc" },
				});

				const lines = await resolveTranscriptTail(status, transcriptPath, 10);

				expect(lines).toEqual(["first", "second", "third"]);
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		});

		it("falls back to file tail when no tmux session is known", async () => {
			const dir = mkdtempSync(`${tmpdir()}/cuekit-resolve-no-session-`);
			try {
				const transcriptPath = join(dir, "transcript.txt");
				writeFileSync(transcriptPath, "alpha\nbeta\n");
				const status = statusFor({}); // no metadata.tmux_session_name, no attach_hint

				const lines = await resolveTranscriptTail(status, transcriptPath, 10);

				expect(lines).toEqual(["alpha", "beta"]);
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		});

		it("falls back to file tail when capture-pane fails", async () => {
			// Running status + session name BUT tmux server has no such session.
			// captureLivePaneTail returns null, so resolve must use file.
			const dir = mkdtempSync(`${tmpdir()}/cuekit-resolve-capture-fail-`);
			try {
				const transcriptPath = join(dir, "transcript.txt");
				writeFileSync(transcriptPath, "fallback-line\n");
				const status = statusFor({
					status: "running",
					metadata: { tmux_session_name: "cuekit-task-definitely-not-running-anywhere" },
				});

				const lines = await resolveTranscriptTail(status, transcriptPath, 10);

				expect(lines).toEqual(["fallback-line"]);
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		});
	});
});
