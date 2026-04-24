import { z } from "zod";
import { TaskStatusSchema } from "./task-status.ts";

export const TaskListFilterSchema = z
	.object({
		status: TaskStatusSchema.optional(),
		agent_kind: z.string().optional(),
		session_id: z.string().optional(),
		cwd: z.string().optional(),
		// Page size. Min 1, capped at 1000 so a caller can't ask the store
		// for every task ever recorded in one shot. If omitted, a default
		// page size is applied by the list operation. There is no
		// "unbounded" sentinel — callers that need more than 1000 rows must
		// page via offset.
		limit: z.number().int().min(1).max(1000).optional(),
		// Skip this many rows before returning. Must be paired with an
		// explicit `limit` — offsetting into a default-sized window is
		// almost never what the caller meant (Oracle P1-1).
		offset: z.number().int().min(0).optional(),
	})
	.refine((f) => f.offset === undefined || f.limit !== undefined, {
		message: "offset requires an explicit limit",
		path: ["offset"],
	});

export type TaskListFilter = z.infer<typeof TaskListFilterSchema>;
