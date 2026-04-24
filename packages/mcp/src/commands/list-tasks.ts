import { TaskListFilterSchema, TaskSummarySchema } from "@cuekit/core";
import { listTasks } from "@cuekit/store";
import { z } from "incur";
import type { CommandContext } from "../command-context.ts";

// Reuse core's canonical TaskListFilterSchema as the command input so the
// control surface and the persistence layer share one shape definition.
export const ListTasksInputSchema = TaskListFilterSchema;
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
