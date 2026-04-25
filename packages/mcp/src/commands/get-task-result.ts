import { isTerminalTaskStatus, JobErrorSchema, TaskResultSchema } from "@cuekit/core";
import { getTaskById } from "@cuekit/store";
import { z } from "incur";
import type { CommandContext } from "../command-context.ts";

export const GetTaskResultInputSchema = z.object({
	task_id: z.string().min(1).describe("cuekit task id."),
});

export type GetTaskResultInput = z.infer<typeof GetTaskResultInputSchema>;

export const GetTaskResultOutputSchema = z.union([
	TaskResultSchema,
	z.object({ error: JobErrorSchema }),
]);

export type GetTaskResultOutput = z.infer<typeof GetTaskResultOutputSchema>;

export async function runGetTaskResult(
	ctx: CommandContext,
	input: GetTaskResultInput,
): Promise<GetTaskResultOutput> {
	let task = getTaskById(ctx.db, input.task_id);
	if (!task) {
		return {
			error: {
				code: "task_not_found",
				message: `task '${input.task_id}' not found`,
				retryable: false,
			},
		};
	}
	const adapterRes = ctx.registry.require(task.agent_kind);
	if (!adapterRes.ok) {
		return { error: adapterRes.error };
	}
	if (!isTerminalTaskStatus(task.status)) {
		await adapterRes.value.status(input.task_id);
		task = getTaskById(ctx.db, input.task_id);
		if (!task) {
			return {
				error: {
					code: "task_not_found",
					message: `task '${input.task_id}' not found`,
					retryable: false,
				},
			};
		}
		if (!isTerminalTaskStatus(task.status)) {
			return {
				error: {
					code: "invalid_state",
					message: `get_task_result requires a terminal task state, got '${task.status}'`,
					retryable: true,
				},
			};
		}
	}
	const result = await adapterRes.value.collect(input.task_id);
	if (!result.ok) return { error: result.error };
	return result.value;
}
