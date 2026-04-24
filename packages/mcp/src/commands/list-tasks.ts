import { TaskStatusSchema, TaskSummarySchema } from "@cuekit/core";
import { listTasks } from "@cuekit/store";
import { z } from "incur";
import type { CommandContext } from "../command-context.ts";

export const ListTasksInputSchema = z.object({
	status: TaskStatusSchema.optional().describe("Filter by task status."),
	agent_kind: z.string().min(1).optional().describe("Filter by adapter kind."),
	session_id: z.string().min(1).optional().describe("Filter by cuekit session id."),
	cwd: z.string().min(1).optional().describe("Filter by the session's worktree_path."),
});

export type ListTasksInput = z.infer<typeof ListTasksInputSchema>;

export const ListTasksOutputSchema = z.object({
	tasks: z.array(TaskSummarySchema),
});

export type ListTasksOutput = z.infer<typeof ListTasksOutputSchema>;

export async function runListTasks(
	ctx: CommandContext,
	input: ListTasksInput,
): Promise<ListTasksOutput> {
	const rows = listTasks(ctx.db, input);
	return {
		tasks: rows.map((t) => ({
			task_id: t.id,
			agent_kind: t.target_agent_kind,
			status: t.status,
			summary: t.summary ?? undefined,
			updated_at: t.updated_at,
		})),
	};
}
