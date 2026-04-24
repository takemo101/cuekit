import { AckSchema } from "@cuekit/core";
import { getTaskById } from "@cuekit/store";
import { z } from "incur";
import type { CommandContext } from "../command-context.ts";

export const SteerTaskInputSchema = z.object({
	task_id: z.string().min(1).describe("cuekit task id."),
	message: z.string().min(1).describe("Steering text to inject into the running agent."),
	reason: z.string().min(1).optional(),
});

export type SteerTaskInput = z.infer<typeof SteerTaskInputSchema>;

export const SteerTaskOutputSchema = AckSchema;
export type SteerTaskOutput = z.infer<typeof SteerTaskOutputSchema>;

export async function runSteerTask(
	ctx: CommandContext,
	input: SteerTaskInput,
): Promise<SteerTaskOutput> {
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
	return adapterRes.value.steer({
		task_id: input.task_id,
		message: input.message,
		reason: input.reason,
	});
}
