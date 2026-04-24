import { TaskListFilterSchema, TaskSummarySchema } from "@cuekit/core";
import { DEFAULT_LIST_TASKS_LIMIT, listTasks } from "@cuekit/store";
import { z } from "incur";
import type { CommandContext } from "../command-context.ts";

// Reuse core's canonical TaskListFilterSchema as the command input so the
// control surface and the persistence layer share one shape definition.
export const ListTasksInputSchema = TaskListFilterSchema;
export type ListTasksInput = z.infer<typeof ListTasksInputSchema>;

export const ListTasksOutputSchema = z.object({
	tasks: z.array(TaskSummarySchema),
	// True when another page exists — i.e. the caller should re-request with
	// offset advanced. Probed cheaply by asking the store for limit+1 rows.
	has_more: z.boolean(),
	// Offset a caller can pass to fetch the next page. Omitted when
	// `has_more` is false so callers can't accidentally walk past the end.
	next_offset: z.number().int().min(0).optional(),
});

export type ListTasksOutput = z.infer<typeof ListTasksOutputSchema>;

export async function runListTasks(
	ctx: CommandContext,
	input: ListTasksInput,
): Promise<ListTasksOutput> {
	// Probe limit+1 so the caller can tell whether another page exists
	// without a follow-up round-trip. Trim the extra row before returning.
	const limit = input.limit ?? DEFAULT_LIST_TASKS_LIMIT;
	const offset = input.offset ?? 0;
	const rows = listTasks(ctx.db, { ...input, limit: limit + 1 });
	const has_more = rows.length > limit;
	const page = has_more ? rows.slice(0, limit) : rows;
	return {
		tasks: page.map((t) => ({
			task_id: t.id,
			agent_kind: t.target_agent_kind,
			status: t.status,
			summary: t.summary ?? undefined,
			updated_at: t.updated_at,
		})),
		has_more,
		...(has_more ? { next_offset: offset + limit } : {}),
	};
}
