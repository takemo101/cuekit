import { resolve } from "node:path";
import { isTerminalTaskStatus, JobErrorSchema, TaskStatusSchema } from "@cuekit/core";
import { deleteTask, listSessionsByWorktree, listTasksBySession } from "@cuekit/store";
import { z } from "incur";
import { cleanupAdapterTask } from "../adapter-cleanup.ts";
import type { CommandContext } from "../command-context.ts";

const TerminalTaskStatusSchema = z.enum([
	"completed",
	"failed",
	"cancelled",
	"timed_out",
	"blocked",
]);

export const CleanupTasksInputSchema = z.object({
	session_id: z.string().min(1).optional().describe("Clean up terminal tasks in this session."),
	cwd: z.string().min(1).optional().describe("Clean up terminal tasks in sessions for this cwd."),
	statuses: z
		.array(TerminalTaskStatusSchema)
		.min(1)
		.optional()
		.describe(
			"Terminal statuses to clean up. Repeat flag for multiple: --statuses completed --statuses failed. Defaults to all terminal statuses.",
		),
	dry_run: z.boolean().optional().describe("Return matching tasks without deleting them."),
});

export type CleanupTasksInput = z.infer<typeof CleanupTasksInputSchema>;

const CleanupTaskItemSchema = z.object({
	task_id: z.string(),
	session_id: z.string(),
	status: TaskStatusSchema,
	deleted: z.boolean(),
});

export const CleanupTasksOutputSchema = z.discriminatedUnion("ok", [
	z.object({
		ok: z.literal(true),
		message: z.string().optional(),
		dry_run: z.boolean(),
		tasks: z.array(CleanupTaskItemSchema),
	}),
	z.object({
		ok: z.literal(false),
		error: JobErrorSchema,
	}),
]);

export type CleanupTasksOutput = z.infer<typeof CleanupTasksOutputSchema>;

const DEFAULT_TERMINAL_STATUSES = new Set([
	"completed",
	"failed",
	"cancelled",
	"timed_out",
	"blocked",
]);

export async function runCleanupTasks(
	ctx: CommandContext,
	input: CleanupTasksInput,
): Promise<CleanupTasksOutput> {
	if (!input.session_id && !input.cwd) {
		return {
			ok: false,
			error: {
				code: "invalid_input",
				message: "cleanup requires session_id or cwd scope",
				retryable: false,
			},
		};
	}
	if (input.session_id && input.cwd) {
		return {
			ok: false,
			error: {
				code: "invalid_input",
				message: "cleanup accepts only one scope: session_id or cwd",
				retryable: false,
			},
		};
	}

	const allowedStatuses = new Set(input.statuses ?? DEFAULT_TERMINAL_STATUSES);
	const scopedTasks = input.session_id
		? listTasksBySession(ctx.db, input.session_id)
		: listSessionsByWorktree(ctx.db, resolve(input.cwd ?? ".")).flatMap((session) =>
				listTasksBySession(ctx.db, session.id),
			);
	const tasks = scopedTasks.filter(
		(task) => isTerminalTaskStatus(task.status) && allowedStatuses.has(task.status),
	);

	const dryRun = input.dry_run ?? false;
	const results: z.infer<typeof CleanupTaskItemSchema>[] = [];
	for (const task of tasks) {
		if (!dryRun) {
			const cleanup = await cleanupAdapterTask(ctx, task);
			if (!cleanup.ok) return { ok: false, error: cleanup.error };
			deleteTask(ctx.db, task.id);
		}
		results.push({
			task_id: task.id,
			session_id: task.session_id,
			status: task.status,
			deleted: !dryRun,
		});
	}

	return {
		ok: true,
		dry_run: dryRun,
		tasks: results,
		message: `${dryRun ? "matched" : "deleted"} ${results.length} terminal task(s)`,
	};
}
