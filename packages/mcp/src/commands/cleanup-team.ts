import {
	isTerminalTaskStatus,
	JobErrorSchema,
	TaskStatusSchema,
	TeamTaskCountsSchema,
} from "@cuekit/core";
import {
	clearTaskTeamMultiplexerMetadata,
	deleteTask,
	getTaskTeamById,
	getTaskTeamMultiplexerMetadata,
	listTasksByTeam,
} from "@cuekit/store";
import { z } from "incur";
import { cleanupAdapterTask } from "../adapter-cleanup.ts";
import type { CommandContext } from "../command-context.ts";
import { fireTeamCompleteHookIfDone } from "../team-hooks.ts";
import { countTeamTasks } from "../team-status.ts";

export const CleanupTeamInputSchema = z.object({
	team_id: z.string().min(1),
	dry_run: z.boolean().optional(),
});

export type CleanupTeamInput = z.infer<typeof CleanupTeamInputSchema>;

const CleanupTeamDeletedTaskSchema = z.object({
	task_id: z.string(),
	status: TaskStatusSchema,
});

export const CleanupTeamOutputSchema = z.union([
	z.object({
		team_id: z.string(),
		dry_run: z.boolean(),
		deleted: z.array(CleanupTeamDeletedTaskSchema),
		remaining: TeamTaskCountsSchema,
	}),
	z.object({ error: JobErrorSchema }),
]);

export type CleanupTeamOutput = z.infer<typeof CleanupTeamOutputSchema>;

export async function runCleanupTeam(
	ctx: CommandContext,
	input: CleanupTeamInput,
): Promise<CleanupTeamOutput> {
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
	const dryRun = input.dry_run ?? false;
	const tasks = listTasksByTeam(ctx.db, team.id);
	const terminalTasks = tasks.filter((task) => isTerminalTaskStatus(task.status));
	if (!dryRun) {
		const removesLastTeamTasks = tasks.length > 0 && terminalTasks.length === tasks.length;
		if (removesLastTeamTasks) fireTeamCompleteHookIfDone(ctx, team.id);
		for (const task of terminalTasks) {
			const cleanup = await cleanupAdapterTask(ctx, task);
			if (!cleanup.ok) return { error: cleanup.error };
		}
		if (removesLastTeamTasks && ctx.panes?.killTeamSession) {
			try {
				if (ctx.panes.restoreTeamWorkspaceHandle) {
					const teamHandle = getTaskTeamMultiplexerMetadata(ctx.db, team.id, ctx.panes.kind);
					if (teamHandle !== undefined) {
						ctx.panes.restoreTeamWorkspaceHandle(team.id, teamHandle);
					}
				}
				await ctx.panes.killTeamSession(team.id);
				clearTaskTeamMultiplexerMetadata(ctx.db, team.id, ctx.panes.kind);
			} catch (error) {
				return {
					error: {
						code: "runtime_crash",
						message: `team session cleanup failed for team '${team.id}'`,
						retryable: true,
						details: {
							team_id: team.id,
							cause: error instanceof Error ? error.message : String(error),
						},
					},
				};
			}
		}
		for (const task of terminalTasks) {
			deleteTask(ctx.db, task.id);
		}
	}
	return {
		team_id: team.id,
		dry_run: dryRun,
		deleted: terminalTasks.map((task) => ({ task_id: task.id, status: task.status })),
		remaining: countTeamTasks(dryRun ? tasks : listTasksByTeam(ctx.db, team.id)),
	};
}
