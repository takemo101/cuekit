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
import { buildTeamAttentionItems } from "../src/team-attention.ts";

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
		});
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
});
