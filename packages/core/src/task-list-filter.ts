import { z } from "zod";
import { TaskStatusSchema } from "./task-status.ts";

export const TaskListFilterSchema = z.object({
	status: TaskStatusSchema.optional(),
	agent_kind: z.string().optional(),
	session_id: z.string().optional(),
	cwd: z.string().optional(),
	// Page size. Min 1, capped at 1000 so a caller can't ask the store for
	// every task ever recorded in one shot. If omitted, the store applies a
	// default (see `DEFAULT_LIST_TASKS_LIMIT`). There is no "unbounded"
	// sentinel — callers that need more than 1000 rows must page via offset.
	limit: z.number().int().min(1).max(1000).optional(),
	// Skip this many rows before returning. Pairs with `limit` to walk
	// pages: limit=50, offset=0 → first 50; offset=50 → next 50.
	offset: z.number().int().min(0).optional(),
});

export type TaskListFilter = z.infer<typeof TaskListFilterSchema>;
