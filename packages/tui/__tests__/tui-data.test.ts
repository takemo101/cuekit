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
	getTaskById,
	listTaskEvents,
	listTasks,
	runMigrations,
	updateTaskChildTokenHash,
	updateTaskRefs,
} from "@cuekit/store";
import type { TuiContext } from "../src/context.ts";
import {
	loadTaskDetail,
	loadTaskList,
	readTranscriptTail,
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

	it("strips DEL and C1 terminal control bytes from transcript text", () => {
		expect(sanitizeTerminalText("\u009b31mred\u009dtitle\u007f text")).toBe("31mredtitle text");
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
});
