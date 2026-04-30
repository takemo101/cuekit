import { isTerminalTaskStatus, JobErrorSchema } from "@cuekit/core";
import { deleteTask, getTaskById } from "@cuekit/store";
import { z } from "incur";
import type { CommandContext } from "../command-context.ts";

export const DeleteTasksInputSchema = z.object({
	task_ids: z
		.array(z.string().min(1))
		.min(1)
		.describe(
			"cuekit task ids to delete. Repeat flag for multiple: --task_ids t_a --task_ids t_b.",
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

function duplicateTaskId(taskIds: string[]): string | null {
	const seen = new Set<string>();
	for (const taskId of taskIds) {
		if (seen.has(taskId)) return taskId;
		seen.add(taskId);
	}
	return null;
}

function invalidInput(message: string): DeleteTasksOutput {
	return { ok: false, error: { code: "invalid_input", message, retryable: false } };
}

export async function runDeleteTasks(
	ctx: CommandContext,
	input: DeleteTasksInput,
): Promise<DeleteTasksOutput> {
	const duplicate = duplicateTaskId(input.task_ids);
	if (duplicate) return invalidInput(`duplicate task_id '${duplicate}'`);

	const results: z.infer<typeof DeleteTaskItemSchema>[] = [];
	for (const taskId of input.task_ids) {
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

		const adapter = ctx.registry.get(task.agent_kind);
		await adapter?.cleanup?.(taskId).catch(() => {});
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
