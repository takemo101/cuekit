import { JobErrorSchema, TaskResultSchema } from "@cuekit/core";
import { getTaskById } from "@cuekit/store";
import { z } from "incur";
import type { CommandContext } from "../command-context.ts";

export const GetTaskResultInputSchema = z.object({
	task_id: z.string().min(1).describe("cuekit task id."),
});

export type GetTaskResultInput = z.infer<typeof GetTaskResultInputSchema>;

export const GetTaskResultOutputSchema = z.discriminatedUnion("ok", [
	z.object({ ok: z.literal(true), value: TaskResultSchema }),
	z.object({ ok: z.literal(false), error: JobErrorSchema }),
]);

export type GetTaskResultOutput = z.infer<typeof GetTaskResultOutputSchema>;

export async function runGetTaskResult(
	ctx: CommandContext,
	input: GetTaskResultInput,
): Promise<GetTaskResultOutput> {
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
	const adapterRes = ctx.registry.require(task.agent_kind);
	if (!adapterRes.ok) {
		return { ok: false, error: adapterRes.error };
	}
	return adapterRes.value.collect(input.task_id);
}
