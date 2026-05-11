import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hasTmux } from "@cuekit/adapters/testing";
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
	loadParentSessionList,
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

	it("loads parent session tasks through a command-layer run_kind filter", async () => {
		const tui: TuiContext = {
			async listTasks() {
				return {
					has_more: false,
					tasks: [
						{
							task_id: "t_parent",
							agent_kind: "pi",
							status: "running",
							run_kind: "parent_session",
							long_lived: true,
							updated_at: new Date().toISOString(),
						},
						{
							task_id: "t_worker",
							agent_kind: "pi",
							status: "running",
							updated_at: new Date().toISOString(),
						},
					],
				};
			},
			async getTaskStatus(taskId) {
				return { task_id: taskId, status: "failed" };
			},
			async listTaskEvents() {
				return { events: [] };
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
		};

		const list = await loadParentSessionList(tui);

		expect("tasks" in list).toBe(true);
		if ("tasks" in list) expect(list.tasks.map((task) => task.task_id)).toEqual(["t_parent"]);
	});

	it("continues paging while looking for parent session tasks", async () => {
		let calls = 0;
		const tui: TuiContext = {
			async listTasks(input) {
				calls += 1;
				if (!input.cursor) {
					return {
						has_more: true,
						next_cursor: "page-2",
						tasks: [
							{
								task_id: "t_worker",
								agent_kind: "pi",
								status: "running",
								updated_at: new Date().toISOString(),
							},
						],
					};
				}
				return {
					has_more: false,
					tasks: [
						{
							task_id: "t_parent_late",
							agent_kind: "pi",
							status: "running",
							run_kind: "parent_session",
							updated_at: new Date().toISOString(),
						},
					],
				};
			},
			async getTaskStatus(taskId) {
				return { task_id: taskId, status: "failed" };
			},
			async listTaskEvents() {
				return { events: [] };
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
		};

		const list = await loadParentSessionList(tui, { limit: 100 });

		expect(calls).toBe(2);
		expect("tasks" in list).toBe(true);
		if ("tasks" in list) expect(list.tasks.map((task) => task.task_id)).toEqual(["t_parent_late"]);
	});

	it("loads the cockpit task list without live status refresh", async () => {
		const seenInputs: unknown[] = [];
		const tui: TuiContext = {
			async listTasks(input) {
				seenInputs.push(input);
				return { tasks: [], has_more: false };
			},
			async getTaskStatus(taskId) {
				return { task_id: taskId, status: "failed" };
			},
			async listTaskEvents() {
				return { events: [] };
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
		};

		await loadTaskList(tui);

		expect(seenInputs).toEqual([{ limit: 100, refresh_status: false }]);
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

	const realTmuxSuite = hasTmux() ? describe : describe.skip;
	realTmuxSuite("captureLivePaneTail (real tmux)", () => {
		// Each test creates a unique session name so concurrent runs and
		// the fact that the session may already exist on the user's tmux
		// server cannot collide. afterEach kills it whether the test
		// succeeds or fails.
		const sessionsToKill: string[] = [];

		afterEach(() => {
			for (const session of sessionsToKill) {
				spawnSync("tmux", ["kill-session", "-t", session]);
			}
			sessionsToKill.length = 0;
		});

		function freshSession(): string {
			const name = `cuekit-test-capture-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
			sessionsToKill.push(name);
			return name;
		}

		it("returns the rendered pane content when tmux serves a known session", async () => {
			const session = freshSession();
			// Detached session running `cat` so the pane stays alive while
			// we feed text into stdin. `cat` echoes input back to the
			// pane, which is what capture-pane will see.
			const create = spawnSync("tmux", [
				"new-session",
				"-d",
				"-s",
				session,
				"-x",
				"80",
				"-y",
				"24",
				"cat",
			]);
			expect(create.status).toBe(0);
			// Send a known marker line into the pane.
			spawnSync("tmux", ["send-keys", "-t", session, "live-pane-marker-line", "Enter"]);
			// tmux send-keys is async w.r.t. the pane redrawing; small wait.
			await Bun.sleep(150);

			const lines = await captureLivePaneTail(session, 80);

			expect(lines).not.toBeNull();
			// At least one captured line should contain the marker.
			expect((lines ?? []).some((line) => line.includes("live-pane-marker-line"))).toBe(true);
		});

		it("trims trailing blank lines tmux uses to fill the viewport", async () => {
			const session = freshSession();
			spawnSync("tmux", ["new-session", "-d", "-s", session, "-x", "80", "-y", "24", "cat"]);
			spawnSync("tmux", ["send-keys", "-t", session, "only-line", "Enter"]);
			await Bun.sleep(150);

			const lines = (await captureLivePaneTail(session, 80)) ?? [];

			// The last non-empty line should be the marker; trailing blanks
			// the viewport adds to fill 24 rows must already be trimmed.
			expect(lines[lines.length - 1]).not.toBe("");
		});

		it("returns null when the session exists but capture is empty", async () => {
			const session = freshSession();
			// `true` exits immediately so the pane has no rendered content.
			// tmux's default `remain-on-exit off` will reap the pane; the
			// session may still exist briefly, but capture-pane should
			// return either no rows or only blank rows. captureLivePaneTail
			// trims blanks and treats the empty result as null fallback.
			spawnSync("tmux", ["new-session", "-d", "-s", session, "-x", "80", "-y", "24", "true"]);
			await Bun.sleep(100);

			const lines = await captureLivePaneTail(session, 80);

			// Either the pane is gone (capture-pane fails → null) or it
			// rendered only blanks (trim → empty → null). Both map to the
			// fallback path.
			expect(lines).toBeNull();
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

				const result = await resolveTranscriptTail(status, transcriptPath, 10);

				expect(result).toEqual({ lines: ["first", "second", "third"], source: "file" });
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

				const result = await resolveTranscriptTail(status, transcriptPath, 10);

				expect(result).toEqual({ lines: ["alpha", "beta"], source: "file" });
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		});

		it("skips live capture on backend mismatch and falls back to file tail", async () => {
			const dir = mkdtempSync(`${tmpdir()}/cuekit-resolve-backend-mismatch-`);
			try {
				const transcriptPath = join(dir, "transcript.txt");
				writeFileSync(transcriptPath, "mismatch-fallback\n");
				const status = statusFor({
					status: "running",
					metadata: { pane_backend_kind: "zellij", pane_backend_mismatch: true },
				});
				let captureCalls = 0;

				const result = await resolveTranscriptTail(status, transcriptPath, 10, {
					capturePane: async () => {
						captureCalls += 1;
						return "wrong-backend-live";
					},
				} as never);

				expect(captureCalls).toBe(0);
				expect(result).toEqual({ lines: ["mismatch-fallback"], source: "file" });
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

				const result = await resolveTranscriptTail(status, transcriptPath, 10);

				expect(result).toEqual({ lines: ["fallback-line"], source: "file" });
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		});
	});

	// End-to-end coverage for the live-pane render path's data flow:
	// real tmux session → loadTaskDetail → TuiTaskDetail. A render-level
	// assertion (mounting TaskDetail in a test renderer, then
	// captureCharFrame) is intentionally not done here — the hard
	// invariant is the data layer correctly carrying capture-pane bytes
	// through resolveTranscriptTail into TuiTaskDetail; the render
	// layer joins lines with `\n` and is exercised by the scrollbox
	// padding tests in `task-detail.test.ts`. If a render regression
	// shows up later, the right move is to add a TaskDetail-mounting
	// test using `createTestRenderer` from `@opentui/core/testing`.
	const liveIntegSuite = hasTmux() ? describe : describe.skip;
	liveIntegSuite("loadTaskDetail (real tmux integration)", () => {
		const sessionsToKill: string[] = [];

		afterEach(() => {
			for (const session of sessionsToKill) {
				spawnSync("tmux", ["kill-session", "-t", session]);
			}
			sessionsToKill.length = 0;
		});

		function freshTaskAndSession(db: Database): { taskId: string; sessionName: string } {
			const taskId = `t_live_integ_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
			const sessionName = `cuekit-task-${taskId}`;
			sessionsToKill.push(sessionName);
			createSession(db, {
				id: `s_${taskId}`,
				project_root: "/tmp/cuekit-live-integ",
				worktree_path: "/tmp/cuekit-live-integ",
				parent_agent_kind: "cli",
			});
			createTask(db, {
				id: taskId,
				session_id: `s_${taskId}`,
				agent_kind: "claude-code",
				objective: "x",
				status: "running",
				native_task_ref: sessionName,
			});
			return { taskId, sessionName };
		}

		it("loadTaskDetail returns transcriptSource: 'live' with the captured pane content", async () => {
			const { db, tui } = makeCtx();
			const { taskId, sessionName } = freshTaskAndSession(db);

			// Boot a real tmux session backing the task and stamp a known
			// marker into its rendered screen.
			const create = spawnSync("tmux", [
				"new-session",
				"-d",
				"-s",
				sessionName,
				"-x",
				"80",
				"-y",
				"24",
				"cat",
			]);
			expect(create.status).toBe(0);
			spawnSync("tmux", ["send-keys", "-t", sessionName, "live-integ-marker-token", "Enter"]);
			await Bun.sleep(150);

			// `loadTaskDetail` reads the task row, then resolves the
			// transcript via the live-pane path because the task is
			// running and `metadata.tmux_session_name` is populated by
			// the test ctx (we expose it through `getTaskStatus`).
			const integCtx: TuiContext = {
				...tui,
				async getTaskStatus(id) {
					const base = await tui.getTaskStatus(id);
					return {
						...base,
						metadata: { tmux_session_name: sessionName },
					};
				},
			};

			const detail = await loadTaskDetail(integCtx, taskId);

			expect(detail.transcriptSource).toBe("live");
			expect(detail.transcriptTail.some((line) => line.includes("live-integ-marker-token"))).toBe(
				true,
			);
		});

		it("loadTaskDetail falls back to transcriptSource: 'file' when the session is gone", async () => {
			const { db, tui } = makeCtx();
			const taskId = `t_live_integ_fallback_${Date.now()}`;
			createSession(db, {
				id: `s_${taskId}`,
				project_root: "/tmp/cuekit-live-integ",
				worktree_path: "/tmp/cuekit-live-integ",
				parent_agent_kind: "cli",
			});
			createTask(db, {
				id: taskId,
				session_id: `s_${taskId}`,
				agent_kind: "claude-code",
				objective: "x",
				status: "running",
				native_task_ref: `cuekit-task-${taskId}`,
			});
			// Plant a transcript file so the file-fallback can return
			// content; the session name we hand to the test ctx points
			// at a guaranteed-missing tmux session, forcing capture-pane
			// to fail.
			const dir = mkdtempSync(`${tmpdir()}/cuekit-live-integ-fallback-`);
			try {
				const transcriptPath = join(dir, "transcript.txt");
				writeFileSync(transcriptPath, "fallback-marker-token\n");
				updateTaskRefs(db, taskId, { transcript_ref: transcriptPath });

				const integCtx: TuiContext = {
					...tui,
					async getTaskStatus(id) {
						const base = await tui.getTaskStatus(id);
						return {
							...base,
							metadata: { tmux_session_name: "cuekit-task-definitely-not-running" },
						};
					},
				};

				const detail = await loadTaskDetail(integCtx, taskId);

				expect(detail.transcriptSource).toBe("file");
				expect(detail.transcriptTail).toContain("fallback-marker-token");
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		});
	});
});
