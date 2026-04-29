import { JobErrorSchema, TaskResultSchema, TaskStatusSchema } from "@cuekit/core";
import { z } from "incur";
import type { CommandContext } from "../command-context.ts";
import { runWaitTasks } from "./wait-tasks.ts";

const TaskEventOutputSchema = z.object({
	sequence: z.number().int().positive(),
	id: z.string(),
	task_id: z.string(),
	type: z.string(),
	message: z.string().nullable(),
	payload: z.unknown().nullable(),
	created_at: z.string(),
});

export const WaitTaskInputSchema = z.object({
	task_id: z.string().min(1).describe("cuekit task id to wait for."),
	session_id: z.string().min(1).optional().describe("Restrict waiting to this cuekit session."),
	cwd: z
		.string()
		.min(1)
		.optional()
		.describe("Restrict waiting to sessions for this worktree path."),
	timeout_ms: z.number().int().min(0).optional(),
	poll_interval_ms: z.number().int().min(1).optional(),
	include_result: z.boolean().optional(),
	include_events: z.boolean().optional(),
	since_event_sequence: z.number().int().min(0).optional(),
});

export type WaitTaskInput = z.infer<typeof WaitTaskInputSchema>;

export const WaitTaskOutputSchema = z.object({
	task_id: z.string(),
	status: TaskStatusSchema.optional(),
	terminal: z.boolean(),
	done: z.boolean(),
	timed_out: z.boolean(),
	result: TaskResultSchema.optional(),
	events: z.array(TaskEventOutputSchema).optional(),
	error: JobErrorSchema.optional(),
});

export type WaitTaskOutput = z.infer<typeof WaitTaskOutputSchema>;

export async function runWaitTask(
	ctx: CommandContext,
	input: WaitTaskInput,
): Promise<WaitTaskOutput> {
	const waited = await runWaitTasks(ctx, {
		task_ids: [input.task_id],
		...(input.session_id ? { session_id: input.session_id } : {}),
		...(input.cwd ? { cwd: input.cwd } : {}),
		timeout_ms: input.timeout_ms,
		poll_interval_ms: input.poll_interval_ms,
		include_results: input.include_result,
		include_events: input.include_events,
		...(input.since_event_sequence !== undefined
			? { since_event_sequences: { [input.task_id]: input.since_event_sequence } }
			: {}),
	});
	const task = waited.tasks[0];
	return {
		task_id: input.task_id,
		status: task?.status,
		terminal: task?.terminal ?? false,
		done: waited.done,
		timed_out: waited.timed_out,
		result: task?.result,
		events: task?.events,
		error: waited.error,
	};
}
