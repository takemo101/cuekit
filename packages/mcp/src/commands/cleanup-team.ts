import {
	isTerminalTaskStatus,
	JobErrorSchema,
	TaskStatusSchema,
	TeamTaskCountsSchema,
} from "@cuekit/core";
import { deleteTask, getTaskTeamById, listTasksByTeam } from "@cuekit/store";
import { z } from "incur";
import { cleanupAdapterTask } from "../adapter-cleanup.ts";
import type { CommandContext } from "../command-context.ts";
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
		for (const task of terminalTasks) {
			const cleanup = await cleanupAdapterTask(ctx, task);
			if (!cleanup.ok) return { error: cleanup.error };
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
