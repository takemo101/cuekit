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
		// Minimal error envelope (mcp-api-spec §6.5). Earlier revisions
		// fabricated `created_at = updated_at = new Date()` and
		// `agent_kind: "unknown"` to satisfy a stricter schema; that
		// produced a typed lie callers couldn't distinguish from a real
		// just-started task. The schema (#TaskStatusViewSchema) now
		// makes those fields optional precisely so this case can be
		// honest about what it doesn't know.
		return {
			task_id: input.task_id,
			status: "failed",
			error: {
				code: "task_not_found",
				message: `task '${input.task_id}' not found`,
				retryable: false,
			},
		};
	}
	const adapterRes = ctx.registry.require(task.agent_kind);
	if (!adapterRes.ok) {
		// Adapter is unregistered — we know the task's real timestamps
		// from the row, so emit them honestly. agent_kind is the
		// runtime the row claims to belong to (still useful even if
		// the adapter is missing).
		return {
			task_id: input.task_id,
			agent_kind: task.agent_kind,
			status: "failed",
			created_at: task.created_at,
			updated_at: task.updated_at,
			error: adapterRes.error,
		};
	}
	return adapterRes.value.status(input.task_id);
}
