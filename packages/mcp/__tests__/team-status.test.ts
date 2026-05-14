import { describe, expect, it } from "bun:test";
import type { Task, TaskTeamRow } from "@cuekit/store";
import {
	aggregateTeamStatus,
	buildCoordinatorFinalizationHint,
	buildTeamSummary,
	countTeamTasks,
	groupTasksByPosition,
} from "../src/team-status.ts";

const now = "2026-05-01T00:00:00.000Z";

function task(
	id: string,
	status: Task["status"],
	team_position: Task["team_position"] = null,
): Task {
	return {
		id,
		session_id: "s1",
		parent_task_id: null,
		agent_kind: "claude-code",
		model: null,
		role: null,
		role_source: null,
		role_selection_reason: null,
		team_id: "tm_1",
		team_position,
		objective: "x",
		status,
		native_task_ref: null,
		child_token_hash: null,
		summary: null,
		result_ref: null,
		transcript_ref: null,
		created_at: now,
		updated_at: now,
		started_at: null,
		completed_at: null,
		spec_json: null,
	};
}

const team: TaskTeamRow = {
	id: "tm_1",
	session_id: "s1",
	title: "Implement teams",
	objective: "Coordinate work",
	metadata_json: '{"source":"test"}',
	created_at: now,
	updated_at: now,
};

describe("team status aggregation", () => {
	it("derives aggregate status from member tasks", () => {
		expect(aggregateTeamStatus([])).toBe("empty");
		expect(aggregateTeamStatus([task("t1", "queued")])).toBe("running");
		expect(aggregateTeamStatus([task("t1", "input_required")])).toBe("running");
		expect(aggregateTeamStatus([task("t1", "completed"), task("t2", "completed")])).toBe(
			"completed",
		);
		expect(aggregateTeamStatus([task("t1", "cancelled")])).toBe("cancelled");
		expect(aggregateTeamStatus([task("t1", "failed"), task("t2", "failed")])).toBe("failed");
		expect(aggregateTeamStatus([task("t1", "timed_out")])).toBe("timed_out");
		expect(aggregateTeamStatus([task("t1", "blocked")])).toBe("blocked");
		expect(aggregateTeamStatus([task("t1", "completed"), task("t2", "failed")])).toBe("mixed");
	});

	it("counts tasks by status", () => {
		expect(countTeamTasks([task("t1", "queued"), task("t2", "completed")])).toEqual({
			total: 2,
			queued: 1,
			running: 0,
			input_required: 0,
			completed: 1,
			failed: 0,
			cancelled: 0,
			timed_out: 0,
			blocked: 0,
		});
	});

	it("groups task summaries by team position", () => {
		const grouped = groupTasksByPosition([
			{
				task_id: "t1",
				agent_kind: "pi",
				status: "running",
				position: "coordinator",
				updated_at: now,
			},
			{ task_id: "t2", agent_kind: "pi", status: "running", position: "worker", updated_at: now },
			{ task_id: "t3", agent_kind: "pi", status: "running", position: "reviewer", updated_at: now },
			{ task_id: "t4", agent_kind: "pi", status: "running", position: "observer", updated_at: now },
			{
				task_id: "t5",
				agent_kind: "pi",
				status: "completed",
				position: "finisher",
				updated_at: now,
			},
		]);

		expect(grouped.coordinator.map((item) => item.task_id)).toEqual(["t1"]);
		expect(grouped.worker.map((item) => item.task_id)).toEqual(["t2"]);
		expect(grouped.reviewer.map((item) => item.task_id)).toEqual(["t3"]);
		expect(grouped.finisher.map((item) => item.task_id)).toEqual(["t5"]);
		expect(grouped.observer.map((item) => item.task_id)).toEqual(["t4"]);
	});

	it("groupTasksByPosition returns finisher: [] when no finisher tasks are present", () => {
		const grouped = groupTasksByPosition([
			{
				task_id: "t1",
				agent_kind: "pi",
				status: "running",
				position: "coordinator",
				updated_at: now,
			},
			{ task_id: "t2", agent_kind: "pi", status: "completed", position: "worker", updated_at: now },
		]);

		expect(grouped.finisher).toEqual([]);
	});

	it("builds a team summary", () => {
		const summary = buildTeamSummary(team, [task("t1", "completed")]);

		expect(summary.team_id).toBe("tm_1");
		expect(summary.title).toBe("Implement teams");
		expect(summary.objective).toBe("Coordinate work");
		expect(summary.metadata).toEqual({ source: "test" });
		expect(summary.status).toBe("completed");
		expect(summary.task_counts.completed).toBe(1);
	});

	it("suggests manual coordinator finalization when only the coordinator is still running", () => {
		const hint = buildCoordinatorFinalizationHint([
			task("t_coord", "running", "coordinator"),
			task("t_worker", "completed", "worker"),
			task("t_review", "completed", "reviewer"),
		]);

		expect(hint).toContain("Only coordinator task t_coord is still running");
		expect(hint).toContain("worker/reviewer/finisher tasks are terminal");
		expect(hint).toContain("get_team_result");
		expect(hint).toContain("completed/failed/blocked terminal report");
		expect(hint).toContain("help_requested instead, but that is not terminal");
		expect(hint).toContain("steer");
	});

	it("does not suggest coordinator finalization while non-coordinator tasks are active", () => {
		expect(
			buildCoordinatorFinalizationHint([
				task("t_coord", "running", "coordinator"),
				task("t_worker", "running", "worker"),
			]),
		).toBeUndefined();
		expect(
			buildCoordinatorFinalizationHint([task("t_coord", "running", "coordinator")]),
		).toBeUndefined();
	});
});
