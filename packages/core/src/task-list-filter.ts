import { z } from "zod";
import { TaskStatusSchema } from "./task-status.ts";

export const TaskListFilterSchema = z.object({
	status: TaskStatusSchema.optional(),
	agent_kind: z.string().optional(),
	session_id: z.string().optional(),
	cwd: z.string().optional(),
	// Page size. Min 1, capped at 1000 so a caller can't ask the store
	// for every task ever recorded in one shot. If omitted, a default
	// page size is applied by the list operation. There is no
	// "unbounded" sentinel — callers that need more than 1000 rows must
	// page via cursor.
	limit: z.number().int().min(1).max(1000).optional(),
	// Opaque keyset cursor — pass back exactly the `next_cursor` returned
	// on the previous page. Never hand-craft. When omitted, the page
	// starts from the most recently updated row.
	cursor: z.string().optional(),
});

export type TaskListFilter = z.infer<typeof TaskListFilterSchema>;
