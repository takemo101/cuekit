import { AckSchema, isTerminalTaskStatus } from "@cuekit/core";
import { deleteTask, getTaskById } from "@cuekit/store";
import { z } from "incur";
import type { CommandContext } from "../command-context.ts";

// Removes a task row from the DB. Policy: only terminal tasks
// (completed / failed / cancelled) can be deleted — running or queued
// tasks must be cancelled first. This keeps deletion a pure data-
// management operation and prevents orphaning live tmux panes.
//
// Does not touch the artifact directory (.cuekit/tasks/<id>/); the
// transcript and result files remain on disk for audit. Operators
// that want full cleanup remove the directory themselves.

export const DeleteTaskInputSchema = z.object({
	task_id: z.string().min(1).describe("cuekit task id."),
});

export type DeleteTaskInput = z.infer<typeof DeleteTaskInputSchema>;

export const DeleteTaskOutputSchema = AckSchema;
export type DeleteTaskOutput = z.infer<typeof DeleteTaskOutputSchema>;

export async function runDeleteTask(
	ctx: CommandContext,
	input: DeleteTaskInput,
): Promise<DeleteTaskOutput> {
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
	if (!isTerminalTaskStatus(task.status)) {
		return {
			ok: false,
			error: {
				code: "invalid_state",
				message: `task '${input.task_id}' is ${task.status}; cancel it before deleting`,
				retryable: false,
			},
		};
	}
	// Best-effort tmux cleanup before wiping the DB row so that the task's
	// tmux session (cuekit-task-<id>) doesn't linger after deletion.
	const adapter = ctx.registry.get(task.agent_kind);
	await adapter?.cleanup?.(input.task_id).catch(() => {});
	deleteTask(ctx.db, input.task_id);
	return { ok: true, message: `deleted task '${input.task_id}'` };
}
