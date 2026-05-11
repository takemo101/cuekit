import { isTerminalTaskStatus, JobErrorSchema } from "@cuekit/core";
import { deleteTask, getTaskById, listTasksByTeam } from "@cuekit/store";
import { z } from "incur";
import { cleanupAdapterTask } from "../adapter-cleanup.ts";
import type { CommandContext } from "../command-context.ts";
import { findFirstDuplicate } from "./_duplicates.ts";
import { normalizeIdList } from "./_normalize-id-list.ts";

export const DeleteTasksInputSchema = z.object({
	task_ids: z
		.array(z.string().min(1))
		.min(1)
		.describe(
			"cuekit task ids to delete. Repeat flag for multiple (--task_ids t_a --task_ids t_b) or pass a comma-separated list (--task_ids t_a,t_b).",
		),
});

export type DeleteTasksInput = z.infer<typeof DeleteTasksInputSchema>;

const DeleteTaskItemSchema = z.object({
	task_id: z.string(),
	ok: z.boolean(),
	message: z.string().optional(),
	error: JobErrorSchema.optional(),
});

export const DeleteTasksOutputSchema = z.discriminatedUnion("ok", [
	z.object({
		ok: z.literal(true),
		message: z.string().optional(),
		tasks: z.array(DeleteTaskItemSchema),
	}),
	z.object({
		ok: z.literal(false),
		error: JobErrorSchema,
		tasks: z.array(DeleteTaskItemSchema).optional(),
	}),
]);

export type DeleteTasksOutput = z.infer<typeof DeleteTasksOutputSchema>;

function invalidInput(message: string): DeleteTasksOutput {
	return { ok: false, error: { code: "invalid_input", message, retryable: false } };
}

export async function runDeleteTasks(
	ctx: CommandContext,
	input: DeleteTasksInput,
): Promise<DeleteTasksOutput> {
	const taskIds = normalizeIdList(input.task_ids);
	if (taskIds.length === 0) {
		return invalidInput("task_ids contained only empty values after splitting");
	}
	const duplicate = findFirstDuplicate(taskIds);
	if (duplicate) return invalidInput(`duplicate task_id '${duplicate}'`);

	const results: z.infer<typeof DeleteTaskItemSchema>[] = [];
	for (const taskId of taskIds) {
		const task = getTaskById(ctx.db, taskId);
		if (!task) {
			results.push({
				task_id: taskId,
				ok: false,
				error: {
					code: "task_not_found",
					message: `task '${taskId}' not found`,
					retryable: false,
				},
			});
			continue;
		}
		if (!isTerminalTaskStatus(task.status)) {
			results.push({
				task_id: taskId,
				ok: false,
				error: {
					code: "invalid_state",
					message: `task '${taskId}' is ${task.status}; cancel it before deleting`,
					retryable: false,
				},
			});
			continue;
		}

		const isLastTeamTask = task.team_id
			? listTasksByTeam(ctx.db, task.team_id).every((teammate) => teammate.id === taskId)
			: false;
		const cleanup = await cleanupAdapterTask(ctx, task);
		if (!cleanup.ok) {
			results.push({ task_id: taskId, ok: false, error: cleanup.error });
			continue;
		}
		if (task.team_id && isLastTeamTask) {
			try {
				await ctx.panes?.killTeamSession?.(task.team_id);
			} catch (error) {
				results.push({
					task_id: taskId,
					ok: false,
					error: {
						code: "runtime_crash",
						message: `team session cleanup failed for team '${task.team_id}'`,
						retryable: true,
						details: {
							team_id: task.team_id,
							cause: error instanceof Error ? error.message : String(error),
						},
					},
				});
				continue;
			}
		}
		deleteTask(ctx.db, taskId);
		results.push({ task_id: taskId, ok: true, message: `deleted task '${taskId}'` });
	}

	const failed = results.find((result) => !result.ok);
	if (failed?.error) {
		return { ok: false, error: failed.error, tasks: results };
	}
	return {
		ok: true,
		message: `deleted ${results.length} task(s)`,
		tasks: results,
	};
}
