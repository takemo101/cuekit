import { TaskStatusSchema, TeamPositionSchema } from "@cuekit/core";
import { listTaskEvents, type Task } from "@cuekit/store";
import { z } from "incur";
import type { CommandContext } from "./command-context.ts";

const POSITIONS = ["coordinator", "worker", "reviewer", "observer"] as const;
const REPORT_TYPES = new Set(["progress", "completed", "failed", "blocked", "help_requested"]);
const TERMINAL_REPORT_TYPES = new Set(["completed", "failed", "blocked"]);
const MAX_MESSAGE_LENGTH = 240;
const MAX_ENTRIES_PER_POSITION = 5;

export const TeamRunSummaryEntrySchema = z.object({
	task_id: z.string(),
	type: z.string(),
	status: TaskStatusSchema,
	message: z.string(),
	created_at: z.string().datetime({ offset: true }),
});

export const TeamRunSummarySchema = z.object({
	completed_reports: z.number().int().nonnegative(),
	latest_completed_message: z.string().optional(),
	positions: z.record(TeamPositionSchema, z.array(TeamRunSummaryEntrySchema)),
	open_attention: z
		.array(
			z.object({
				task_id: z.string(),
				position: TeamPositionSchema.optional(),
				status: TaskStatusSchema,
				message: z.string().optional(),
			}),
		)
		.optional(),
});

export type TeamRunSummary = z.infer<typeof TeamRunSummarySchema>;

function truncateMessage(message: string): string {
	return message.length <= MAX_MESSAGE_LENGTH
		? message
		: `${message.slice(0, MAX_MESSAGE_LENGTH - 1)}…`;
}

function emptyPositions(): TeamRunSummary["positions"] {
	return {
		coordinator: [],
		worker: [],
		reviewer: [],
		observer: [],
	};
}

function taskPosition(task: Task): (typeof POSITIONS)[number] | undefined {
	return POSITIONS.find((position) => position === task.team_position);
}

export function emptyTeamRunSummary(): TeamRunSummary {
	return {
		completed_reports: 0,
		positions: emptyPositions(),
	};
}

export function buildTeamRunSummary(ctx: CommandContext, tasks: Task[]): TeamRunSummary {
	const positions = emptyPositions();
	let completedReports = 0;
	let latestCompletedMessage: string | undefined;
	const openAttention: NonNullable<TeamRunSummary["open_attention"]> = [];

	for (const task of tasks) {
		const position = taskPosition(task);
		let latestMessage: string | undefined;
		for (const event of listTaskEvents(ctx.db, task.id)) {
			if (!event.message || !REPORT_TYPES.has(event.type)) continue;
			latestMessage = event.message;
			const entry = {
				task_id: task.id,
				type: event.type,
				status: task.status,
				message: truncateMessage(event.message),
				created_at: event.created_at,
			};
			if (position) positions[position].push(entry);
			if (TERMINAL_REPORT_TYPES.has(event.type)) {
				completedReports += 1;
				latestCompletedMessage = event.message;
			}
		}
		if (
			task.status === "running" ||
			task.status === "input_required" ||
			task.status === "blocked"
		) {
			openAttention.push({
				task_id: task.id,
				...(position ? { position } : {}),
				status: task.status,
				...(latestMessage ? { message: truncateMessage(latestMessage) } : {}),
			});
		}
	}

	for (const position of POSITIONS) {
		positions[position] = positions[position].slice(-MAX_ENTRIES_PER_POSITION);
	}

	return {
		completed_reports: completedReports,
		...(latestCompletedMessage
			? { latest_completed_message: truncateMessage(latestCompletedMessage) }
			: {}),
		positions,
		...(openAttention.length > 0 ? { open_attention: openAttention } : {}),
	};
}
