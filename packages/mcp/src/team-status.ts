import {
	isTerminalTaskStatus,
	type TaskSummary,
	type TeamPosition,
	type TeamStatus,
	type TeamSummary,
	type TeamTaskCounts,
} from "@cuekit/core";
import type { Task, TaskTeamRow } from "@cuekit/store";

const ZERO_COUNTS: TeamTaskCounts = {
	total: 0,
	queued: 0,
	running: 0,
	input_required: 0,
	completed: 0,
	failed: 0,
	cancelled: 0,
	timed_out: 0,
	blocked: 0,
};

const POSITIONS: TeamPosition[] = ["coordinator", "worker", "reviewer", "finisher", "observer"];

export function aggregateTeamStatus(tasks: Pick<Task, "status">[]): TeamStatus {
	if (tasks.length === 0) return "empty";
	if (tasks.some((task) => !isTerminalTaskStatus(task.status))) return "running";
	const statuses = new Set(tasks.map((task) => task.status));
	if (statuses.size === 1) {
		const [status] = [...statuses];
		return status as TeamStatus;
	}
	return "mixed";
}

export function countTeamTasks(tasks: Pick<Task, "status">[]): TeamTaskCounts {
	const counts = { ...ZERO_COUNTS };
	counts.total = tasks.length;
	for (const task of tasks) {
		counts[task.status] += 1;
	}
	return counts;
}

export function groupTasksByPosition(tasks: TaskSummary[]): Record<TeamPosition, TaskSummary[]> {
	const grouped: Record<TeamPosition, TaskSummary[]> = {
		coordinator: [],
		worker: [],
		reviewer: [],
		finisher: [],
		observer: [],
	};
	for (const task of tasks) {
		if (task.position && POSITIONS.includes(task.position)) {
			grouped[task.position].push(task);
		}
	}
	return grouped;
}

function parseMetadata(metadata_json: string | null): Record<string, unknown> | undefined {
	if (!metadata_json) return undefined;
	try {
		const parsed = JSON.parse(metadata_json);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

export function buildTeamSummary(team: TaskTeamRow, tasks: Task[]): TeamSummary {
	const metadata = parseMetadata(team.metadata_json);
	return {
		team_id: team.id,
		session_id: team.session_id,
		title: team.title,
		...(team.objective ? { objective: team.objective } : {}),
		created_at: team.created_at,
		updated_at: team.updated_at,
		...(metadata ? { metadata } : {}),
		status: aggregateTeamStatus(tasks),
		task_counts: countTeamTasks(tasks),
	};
}
