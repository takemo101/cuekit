import { JobErrorSchema } from "@cuekit/core";
import { getTaskById } from "@cuekit/store";
import { z } from "incur";
import type { CommandContext } from "../command-context.ts";
import { findFirstDuplicate } from "./_duplicates.ts";

export const CancelTasksInputSchema = z.object({
	task_ids: z
		.array(z.string().min(1))
		.min(1)
		.describe(
			"cuekit task ids to cancel. Repeat flag for multiple: --task_ids t_a --task_ids t_b.",
		),
});

export type CancelTasksInput = z.infer<typeof CancelTasksInputSchema>;

const CancelTaskItemSchema = z.object({
	task_id: z.string(),
	ok: z.boolean(),
	message: z.string().optional(),
	error: JobErrorSchema.optional(),
});

export const CancelTasksOutputSchema = z.discriminatedUnion("ok", [
	z.object({
		ok: z.literal(true),
		message: z.string().optional(),
		tasks: z.array(CancelTaskItemSchema),
	}),
	z.object({
		ok: z.literal(false),
		error: JobErrorSchema,
		tasks: z.array(CancelTaskItemSchema).optional(),
	}),
]);

export type CancelTasksOutput = z.infer<typeof CancelTasksOutputSchema>;

export async function runCancelTasks(
	ctx: CommandContext,
	input: CancelTasksInput,
): Promise<CancelTasksOutput> {
	const duplicate = findFirstDuplicate(input.task_ids);
	if (duplicate) {
		return {
			ok: false,
			error: {
				code: "invalid_input",
				message: `duplicate task_id '${duplicate}'`,
				retryable: false,
			},
		};
	}

	const results: z.infer<typeof CancelTaskItemSchema>[] = [];
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
		const adapterRes = ctx.registry.require(task.agent_kind);
		if (!adapterRes.ok) {
			results.push({ task_id: taskId, ok: false, error: adapterRes.error });
			continue;
		}
		const cancelled = await adapterRes.value.cancel(taskId);
		if (cancelled.ok) {
			results.push({ task_id: taskId, ok: true, message: cancelled.message });
		} else {
			results.push({ task_id: taskId, ok: false, error: cancelled.error });
		}
	}

	const failed = results.find((result) => !result.ok);
	if (failed?.error) return { ok: false, error: failed.error, tasks: results };
	return { ok: true, message: `cancelled ${results.length} task(s)`, tasks: results };
}
