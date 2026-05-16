import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, it } from "bun:test";
import {
	appendTaskEvent,
	createSession,
	createTask,
	createTaskTeam,
	runMigrations,
	type Task,
} from "@cuekit/store";
import {
	buildManualSteerHintsFromAttentionItems,
	buildTeamAttentionItems,
} from "../src/team-attention.ts";

let db: Database;
let tasks: Task[];

beforeEach(() => {
	db = new Database(":memory:");
	db.exec("pragma foreign_keys = ON;");
	runMigrations(db);
	createSession(db, {
		id: "s_attention",
		project_root: "/p",
		worktree_path: "/w",
		parent_agent_kind: "pi",
	});
	createTaskTeam(db, { id: "tm_attention", session_id: "s_attention", title: "Team" });
	tasks = [];
});

function task(
	id: string,
	position: Task["team_position"],
	status: Task["status"] = "running",
): Task {
	const created = createTask(db, {
		id,
		session_id: "s_attention",
		agent_kind: "claude-code",
		team_id: "tm_attention",
		...(position ? { team_position: position } : {}),
		objective: `${position ?? "task"} objective`,
		status,
	});
	tasks.push(created);
	return created;
}

describe("team attention items", () => {
	it("derives attention items from non-coordinator important events", () => {
		task("t_coord", "coordinator", "completed");
		task("t_worker", "worker", "blocked");
		task("t_review", "reviewer", "failed");
		task("t_finish", "finisher", "completed");
		appendTaskEvent(db, {
			id: "e_coord",
			task_id: "t_coord",
			type: "completed",
			message: "coordinator final report",
		});
		appendTaskEvent(db, {
			id: "e_worker_progress",
			task_id: "t_worker",
			type: "progress",
			message: "worker progress",
		});
		appendTaskEvent(db, {
			id: "e_worker_blocked",
			task_id: "t_worker",
			type: "blocked",
			message: "worker blocked",
		});
		appendTaskEvent(db, {
			id: "e_review_failed",
			task_id: "t_review",
			type: "failed",
			message: "review failed",
		});
		appendTaskEvent(db, {
			id: "e_finish_done",
			task_id: "t_finish",
			type: "completed",
			message: "finisher completed",
		});

		const items = buildTeamAttentionItems(db, tasks);

		expect(items.map((item) => item.type)).toEqual(["blocked", "failed", "completed"]);
		expect(items.map((item) => item.position)).toEqual(["worker", "reviewer", "finisher"]);
		expect(items.map((item) => item.reason)).toEqual([
			"terminal_report",
			"terminal_report",
			"terminal_report",
		]);
		expect(items.some((item) => item.task_id === "t_coord")).toBe(false);
	});

	it("includes help_requested events", () => {
		task("t_worker", "worker", "running");
		appendTaskEvent(db, {
			id: "e_help",
			task_id: "t_worker",
			type: "help_requested",
			message: "need parent input",
		});

		const items = buildTeamAttentionItems(db, tasks);

		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({
			task_id: "t_worker",
			position: "worker",
			type: "help_requested",
			reason: "help_requested",
			message: "need parent input",
			message_preview: "need parent input",
			full_message: "need parent input",
			steer_target: { task_id: "t_worker" },
		});
	});

	it("exposes explicit preview and full-message semantics without removing message", () => {
		task("t_worker", "worker", "blocked");
		const longMessage = `${"x".repeat(260)} tail`;
		appendTaskEvent(db, {
			id: "e_long",
			task_id: "t_worker",
			type: "blocked",
			message: longMessage,
		});

		const fullItems = buildTeamAttentionItems(db, tasks);
		const previewItems = buildTeamAttentionItems(db, tasks, { includeFullMessage: false });

		expect(fullItems[0]?.message).toBe(longMessage);
		expect(fullItems[0]?.full_message).toBe(longMessage);
		expect(fullItems[0]?.message_preview?.endsWith("…")).toBe(true);
		expect(previewItems[0]?.message).toBe(previewItems[0]?.message_preview);
		expect(previewItems[0]?.full_message).toBeUndefined();
	});

	it("builds manual steer hints as data only for blocked/help attention items", () => {
		task("t_worker", "worker", "blocked");
		task("t_done", "finisher", "completed");
		appendTaskEvent(db, {
			id: "e_blocked",
			task_id: "t_worker",
			type: "blocked",
			message: "need repo context",
		});
		appendTaskEvent(db, {
			id: "e_done",
			task_id: "t_done",
			type: "completed",
			message: "done",
		});

		const hints = buildManualSteerHintsFromAttentionItems(buildTeamAttentionItems(db, tasks));

		expect(hints).toHaveLength(1);
		expect(hints[0]).toMatchObject({
			task_id: "t_worker",
			position: "worker",
			target: { kind: "task", task_id: "t_worker" },
			tool: "steer",
		});
		expect(hints[0]?.suggested_message).toContain("need repo context");
		expect(hints[0]?.rationale).toContain("will not auto-steer");
	});

	it("sorts globally by event sequence instead of task iteration order", () => {
		task("t_later_task", "finisher", "completed");
		task("t_earlier_task", "worker", "blocked");
		const earlier = appendTaskEvent(db, {
			id: "e_earlier",
			task_id: "t_earlier_task",
			type: "blocked",
			message: "earlier event",
		});
		const later = appendTaskEvent(db, {
			id: "e_later",
			task_id: "t_later_task",
			type: "completed",
			message: "later event",
		});

		const items = buildTeamAttentionItems(db, tasks);

		expect(items.map((item) => item.sequence)).toEqual([earlier.sequence, later.sequence]);
		expect(items.map((item) => item.message)).toEqual(["earlier event", "later event"]);
	});

	it("caps to the most recent items while preserving ascending sequence order", () => {
		task("t_worker", "worker", "blocked");
		const first = appendTaskEvent(db, {
			id: "e_first",
			task_id: "t_worker",
			type: "blocked",
			message: "first",
		});
		const second = appendTaskEvent(db, {
			id: "e_second",
			task_id: "t_worker",
			type: "failed",
			message: "second",
		});
		const third = appendTaskEvent(db, {
			id: "e_third",
			task_id: "t_worker",
			type: "help_requested",
			message: "third",
		});

		const items = buildTeamAttentionItems(db, tasks, { limit: 2 });

		expect(items.map((item) => item.sequence)).toEqual([second.sequence, third.sequence]);
		expect(items.map((item) => item.sequence)).not.toContain(first.sequence);
	});

	it("includes tasks without a team position as non-coordinator attention items", () => {
		task("t_unpositioned", null, "blocked");
		appendTaskEvent(db, {
			id: "e_unpositioned",
			task_id: "t_unpositioned",
			type: "blocked",
			message: "unpositioned task blocked",
		});

		const items = buildTeamAttentionItems(db, tasks);

		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({
			task_id: "t_unpositioned",
			type: "blocked",
			reason: "terminal_report",
			message: "unpositioned task blocked",
		});
		expect(items[0]?.position).toBeUndefined();
	});

	it("returns an empty list when the limit is zero", () => {
		task("t_worker", "worker", "blocked");
		appendTaskEvent(db, {
			id: "e_blocked",
			task_id: "t_worker",
			type: "blocked",
			message: "blocked",
		});

		expect(buildTeamAttentionItems(db, tasks, { limit: 0 })).toEqual([]);
	});

	it("includes coordinator blocked/failed/help_requested but excludes completed", () => {
		task("t_coord", "coordinator", "blocked");
		task("t_worker", "worker", "completed");
		appendTaskEvent(db, {
			id: "e_coord_blocked",
			task_id: "t_coord",
			type: "blocked",
			message: "coordinator stuck",
		});
		appendTaskEvent(db, {
			id: "e_coord_completed",
			task_id: "t_coord",
			type: "completed",
			message: "coordinator done",
		});
		appendTaskEvent(db, {
			id: "e_worker_completed",
			task_id: "t_worker",
			type: "completed",
			message: "worker done",
		});

		const items = buildTeamAttentionItems(db, tasks);

		expect(items).toHaveLength(2);
		expect(items.some((item) => item.task_id === "t_coord" && item.type === "blocked")).toBe(true);
		expect(items.some((item) => item.task_id === "t_coord" && item.type === "completed")).toBe(
			false,
		);
		expect(items.some((item) => item.task_id === "t_worker" && item.type === "completed")).toBe(
			true,
		);
	});
});
