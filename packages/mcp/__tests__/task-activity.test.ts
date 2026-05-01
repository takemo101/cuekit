import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	appendTaskEvent,
	createSession,
	createTask,
	runMigrations,
	updateTaskRefs,
} from "@cuekit/store";
import { getTaskActivity } from "../src/task-activity.ts";

function setup() {
	const db = new Database(":memory:");
	db.exec("pragma foreign_keys = ON;");
	runMigrations(db);
	createSession(db, {
		id: "s1",
		project_root: "/tmp/project",
		worktree_path: "/tmp/project",
		parent_agent_kind: "pi",
	});
	return db;
}

describe("getTaskActivity", () => {
	it("reports last event/transcript activity and idle time", () => {
		const db = setup();
		const dir = mkdtempSync(`${tmpdir()}/cuekit-activity-`);
		try {
			const task = createTask(db, {
				id: "t1",
				session_id: "s1",
				agent_kind: "claude-code",
				objective: "x",
				status: "running",
			});
			appendTaskEvent(db, {
				id: "e1",
				task_id: task.id,
				type: "progress",
				message: "working",
			});
			const transcriptPath = join(dir, "transcript.txt");
			writeFileSync(transcriptPath, "Working\n");
			const updated = updateTaskRefs(db, task.id, { transcript_ref: transcriptPath });
			if (!updated) throw new Error("setup failed");

			const activity = getTaskActivity(db, updated, Date.now() + 61_000);

			expect(activity.last_event_at).toBeDefined();
			expect(activity.last_transcript_at).toBeDefined();
			expect(activity.idle_ms).toBeGreaterThanOrEqual(60_000);
			expect(activity.attention_hint).toBe("no_recent_activity");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("detects stop-hook or idle prompt transcript hints", () => {
		const db = setup();
		const dir = mkdtempSync(`${tmpdir()}/cuekit-activity-`);
		try {
			const task = createTask(db, {
				id: "t1",
				session_id: "s1",
				agent_kind: "claude-code",
				objective: "x",
				status: "running",
			});
			const transcriptPath = join(dir, "transcript.txt");
			writeFileSync(transcriptPath, "Stop hook prevented continuation\n");
			const updated = updateTaskRefs(db, task.id, { transcript_ref: transcriptPath });
			if (!updated) throw new Error("setup failed");

			expect(getTaskActivity(db, updated).attention_hint).toBe(
				"stop_hook_or_idle_prompt_suspected",
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
