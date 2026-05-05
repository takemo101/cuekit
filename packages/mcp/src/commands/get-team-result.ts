import {
	isTerminalTaskStatus,
	TeamPositionSchema,
	TeamStatusSchema,
	TeamTaskCountsSchema,
} from "@cuekit/core";
import { getTaskTeamById, listTaskEvents, listTasksByTeam } from "@cuekit/store";
import { z } from "incur";
import { cleanupHintForTeam } from "../cleanup-hints.ts";
import type { CommandContext } from "../command-context.ts";
import { buildTeamAttentionItems, TeamAttentionItemSchema } from "../team-attention.ts";
import { buildTeamSummary } from "../team-status.ts";

const TERMINAL_REPORT_TYPES = new Set(["completed", "failed", "blocked"]);
const REPORT_TYPES = new Set([
	"progress",
	"completed",
	"failed",
	"blocked",
	"help_requested",
	"log",
]);

export const GetTeamResultInputSchema = z.object({
	team_id: z.string().min(1),
});
export type GetTeamResultInput = z.infer<typeof GetTeamResultInputSchema>;

export const TeamResultTimelineEntrySchema = z.object({
	sequence: z.number().int().positive(),
	task_id: z.string(),
	position: TeamPositionSchema.optional(),
	type: z.string(),
	message: z.string().optional(),
	created_at: z.string().datetime({ offset: true }),
});

export const GetTeamResultOutputSchema = z.union([
	z.object({
		team_id: z.string(),
		session_id: z.string(),
		status: TeamStatusSchema,
		task_counts: TeamTaskCountsSchema,
		final_summary: z.string().optional(),
		timeline: z.array(TeamResultTimelineEntrySchema),
		attention_items: z.array(TeamAttentionItemSchema).optional(),
		cleanup_hint: z.string().optional(),
	}),
	z.object({
		error: z.object({
			code: z.literal("team_not_found"),
			message: z.string(),
		}),
	}),
]);
export type GetTeamResultOutput = z.infer<typeof GetTeamResultOutputSchema>;

export function runGetTeamResult(
	ctx: CommandContext,
	input: GetTeamResultInput,
): GetTeamResultOutput {
	const team = getTaskTeamById(ctx.db, input.team_id);
	if (!team) {
		return {
			error: {
				code: "team_not_found",
				message: `Team not found: ${input.team_id}`,
			},
		};
	}

	const tasks = listTasksByTeam(ctx.db, team.id);
	const tasksById = new Map(tasks.map((task) => [task.id, task]));
	const timeline = tasks
		.flatMap((task) =>
			listTaskEvents(ctx.db, task.id)
				.filter((event) => REPORT_TYPES.has(event.type))
				.map((event) => ({
					sequence: event.sequence,
					task_id: task.id,
					...(task.team_position ? { position: task.team_position } : {}),
					type: event.type,
					...(event.message ? { message: event.message } : {}),
					created_at: event.created_at,
				})),
		)
		.toSorted((a, b) => a.sequence - b.sequence);

	const latestCoordinatorTerminal = timeline.findLast(
		(event) =>
			event.position === "coordinator" && TERMINAL_REPORT_TYPES.has(event.type) && event.message,
	);
	const latestTerminal = timeline.findLast(
		(event) => TERMINAL_REPORT_TYPES.has(event.type) && event.message,
	);
	const finalSummary = latestCoordinatorTerminal?.message ?? latestTerminal?.message;
	const attentionItems = buildTeamAttentionItems(ctx.db, tasks);
	const summary = buildTeamSummary(team, [...tasksById.values()]);
	const cleanupHint = cleanupHintForTeam(
		team.id,
		tasks.filter((task) => isTerminalTaskStatus(task.status)).length,
	);

	return {
		team_id: team.id,
		session_id: team.session_id,
		status: summary.status,
		task_counts: summary.task_counts,
		...(finalSummary ? { final_summary: finalSummary } : {}),
		timeline,
		...(attentionItems.length > 0 ? { attention_items: attentionItems } : {}),
		...(cleanupHint ? { cleanup_hint: cleanupHint } : {}),
	};
}
