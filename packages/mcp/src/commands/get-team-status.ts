import {
	JobErrorSchema,
	TaskSummarySchema,
	TeamPositionSchema,
	TeamStatusSchema,
	TeamTaskCountsSchema,
} from "@cuekit/core";
import { getTaskTeamById, listTasksByTeam } from "@cuekit/store";
import { z } from "incur";
import type { CommandContext } from "../command-context.ts";
import { buildTeamRunSummary, TeamRunSummarySchema } from "../team-run-summary.ts";
import { aggregateTeamStatus, countTeamTasks, groupTasksByPosition } from "../team-status.ts";

export const GetTeamStatusInputSchema = z.object({
	team_id: z.string().min(1),
});

export type GetTeamStatusInput = z.infer<typeof GetTeamStatusInputSchema>;

const PositionsSchema = z.record(TeamPositionSchema, z.array(TaskSummarySchema));

export const GetTeamStatusOutputSchema = z.union([
	z.object({
		team_id: z.string(),
		session_id: z.string(),
		title: z.string(),
		objective: z.string().optional(),
		status: TeamStatusSchema,
		task_counts: TeamTaskCountsSchema,
		run_summary: TeamRunSummarySchema,
		positions: PositionsSchema,
		tasks: z.array(TaskSummarySchema),
		created_at: z.string().datetime({ offset: true }),
		updated_at: z.string().datetime({ offset: true }),
	}),
	z.object({ error: JobErrorSchema }),
]);
export type GetTeamStatusOutput = z.infer<typeof GetTeamStatusOutputSchema>;

function toSummary(task: ReturnType<typeof listTasksByTeam>[number]) {
	return {
		task_id: task.id,
		agent_kind: task.agent_kind,
		...(task.model ? { model: task.model } : {}),
		...(task.role ? { role: task.role } : {}),
		...(task.role_source ? { role_source: task.role_source } : {}),
		...(task.role_selection_reason ? { role_selection_reason: task.role_selection_reason } : {}),
		...(task.team_id ? { team_id: task.team_id } : {}),
		...(task.team_position
			? { position: task.team_position as z.infer<typeof TeamPositionSchema> }
			: {}),
		status: task.status,
		...(task.summary ? { summary: task.summary } : {}),
		updated_at: task.updated_at,
	};
}

export function runGetTeamStatus(
	ctx: CommandContext,
	input: GetTeamStatusInput,
): GetTeamStatusOutput {
	const team = getTaskTeamById(ctx.db, input.team_id);
	if (!team) {
		return {
			error: {
				code: "team_not_found",
				message: `team '${input.team_id}' not found`,
				retryable: false,
			},
		};
	}
	const tasks = listTasksByTeam(ctx.db, team.id);
	const summaries = tasks.map(toSummary);
	return {
		team_id: team.id,
		session_id: team.session_id,
		title: team.title,
		...(team.objective ? { objective: team.objective } : {}),
		status: aggregateTeamStatus(tasks),
		task_counts: countTeamTasks(tasks),
		run_summary: buildTeamRunSummary(ctx, tasks),
		positions: groupTasksByPosition(summaries),
		tasks: summaries,
		created_at: team.created_at,
		updated_at: team.updated_at,
	};
}
