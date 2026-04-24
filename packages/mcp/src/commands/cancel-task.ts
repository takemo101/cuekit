import { AckSchema } from "@cuekit/core";
import { getTaskById } from "@cuekit/store";
import { z } from "incur";
import type { CommandContext } from "../command-context.ts";

export const CancelTaskInputSchema = z.object({
	task_id: z.string().min(1).describe("cuekit task id."),
});

export type CancelTaskInput = z.infer<typeof CancelTaskInputSchema>;

export const CancelTaskOutputSchema = AckSchema;
export type CancelTaskOutput = z.infer<typeof CancelTaskOutputSchema>;

export async function runCancelTask(
	ctx: CommandContext,
	input: CancelTaskInput,
): Promise<CancelTaskOutput> {
	const task = getTaskById(ctx.db, input.task_id);
	if (!task) {
		return {
			ok: false,
			error: {
				code: "task_not_found",
				message: `task '${input.task_id}' not found`,
				retryable: false,
			},
		};
	}
	const adapterRes = ctx.registry.require(task.target_agent_kind);
	if (!adapterRes.ok) {
		return { ok: false, error: adapterRes.error };
	}
	return adapterRes.value.cancel(input.task_id);
}
