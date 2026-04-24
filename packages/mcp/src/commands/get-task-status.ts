import { type TaskStatusView, TaskStatusViewSchema } from "@cuekit/core";
import { getTaskById } from "@cuekit/store";
import { z } from "incur";
import type { CommandContext } from "../command-context.ts";

export const GetTaskStatusInputSchema = z.object({
	task_id: z.string().min(1).describe("cuekit task id."),
});

export type GetTaskStatusInput = z.infer<typeof GetTaskStatusInputSchema>;

export const GetTaskStatusOutputSchema = TaskStatusViewSchema;
export type GetTaskStatusOutput = TaskStatusView;

export async function runGetTaskStatus(
	ctx: CommandContext,
	input: GetTaskStatusInput,
): Promise<GetTaskStatusOutput> {
	const task = getTaskById(ctx.db, input.task_id);
	if (!task) {
		const now = new Date().toISOString();
		return {
			task_id: input.task_id,
			agent_kind: "unknown",
			status: "failed",
			created_at: now,
			updated_at: now,
			error: {
				code: "task_not_found",
				message: `task '${input.task_id}' not found`,
				retryable: false,
			},
		};
	}
	const adapterRes = ctx.registry.require(task.target_agent_kind);
	if (!adapterRes.ok) {
		return {
			task_id: input.task_id,
			agent_kind: task.target_agent_kind,
			status: "failed",
			created_at: task.created_at,
			updated_at: task.updated_at,
			error: adapterRes.error,
		};
	}
	return adapterRes.value.status(input.task_id);
}
