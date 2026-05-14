import {
	isTerminalTaskStatus,
	TeamPositionSchema,
	TeamStatusSchema,
	TeamTaskCountsSchema,
} from "@cuekit/core";
import { getTaskTeamById, listTaskEvents, listTasksByTeam, listTeamEvents } from "@cuekit/store";
import { z } from "incur";
import { cleanupHintForTeam } from "../cleanup-hints.ts";
import type { CommandContext } from "../command-context.ts";
import {
	buildManualSteerHintsFromAttentionItems,
	buildTeamAttentionItemsFromEvents,
	ManualSteerHintSchema,
	TeamAttentionItemSchema,
} from "../team-attention.ts";
import { TeamBlackboardEventSchema, toTeamBlackboardEvent } from "../team-blackboard.ts";
import { fireTeamCompleteHookIfDone } from "../team-hooks.ts";
import { buildCoordinatorFinalizationHint, buildTeamSummary } from "../team-status.ts";

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
		blackboard_events: z.array(TeamBlackboardEventSchema),
		attention_items: z.array(TeamAttentionItemSchema).optional(),
		manual_steer_hints: z.array(ManualSteerHintSchema).optional(),
		next_action_hint: z.string().optional(),
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
	const taskEvents = tasks.map((task) => ({ task, events: listTaskEvents(ctx.db, task.id) }));
	const tasksById = new Map(tasks.map((task) => [task.id, task]));
	const blackboardEvents = listTeamEvents(ctx.db, team.id).map(toTeamBlackboardEvent);
	const timeline = taskEvents
		.flatMap(({ task, events }) =>
			events
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
	const attentionItems = buildTeamAttentionItemsFromEvents(taskEvents);
	const manualSteerHints = buildManualSteerHintsFromAttentionItems(attentionItems);
	const summary = buildTeamSummary(team, [...tasksById.values()]);
	const nextActionHint = buildCoordinatorFinalizationHint(tasks);
	if (tasks.length > 0 && tasks.every((task) => isTerminalTaskStatus(task.status))) {
		fireTeamCompleteHookIfDone(ctx, team.id);
	}
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
		blackboard_events: blackboardEvents,
		...(attentionItems.length > 0 ? { attention_items: attentionItems } : {}),
		...(manualSteerHints.length > 0 ? { manual_steer_hints: manualSteerHints } : {}),
		...(nextActionHint ? { next_action_hint: nextActionHint } : {}),
		...(cleanupHint ? { cleanup_hint: cleanupHint } : {}),
	};
}
