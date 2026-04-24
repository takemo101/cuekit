import { z } from "zod";
import { TaskStatusSchema } from "./task-status.ts";

export const TaskListFilterSchema = z.object({
	status: TaskStatusSchema.optional(),
	agent_kind: z.string().optional(),
	session_id: z.string().optional(),
	cwd: z.string().optional(),
	// Page size. Capped at 1000 so a caller can't ask the store for every
	// task ever recorded in one shot. Default (when omitted) is applied at
	// the store layer so callers can still disable paging by passing 0 if
	// they really want unbounded reads.
	limit: z.number().int().min(0).max(1000).optional(),
	// Skip this many rows before returning. Pairs with `limit` to walk
	// pages: limit=50, offset=0 → first 50; offset=50 → next 50.
	offset: z.number().int().min(0).optional(),
});

export type TaskListFilter = z.infer<typeof TaskListFilterSchema>;
