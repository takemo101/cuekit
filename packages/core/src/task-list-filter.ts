import { z } from "zod";
import { TaskStatusSchema } from "./task-status.ts";

export const TaskListFilterSchema = z
	.object({
		status: TaskStatusSchema.optional(),
		agent_kind: z.string().optional(),
		session_id: z.string().optional(),
		team_id: z.string().optional(),
		project_root: z.string().optional(),
		project_uid: z.string().optional(),
		config_root: z.string().optional(),
		project_id: z.string().optional(),
		cwd: z.string().optional(),
		// Page size. Min 1, capped at 1000 so a single request can't pull
		// every recorded task at once. Omitted → implementation default.
		// There is no "unbounded" sentinel; callers that need more than
		// 1000 rows must page via cursor.
		limit: z.number().int().min(1).max(1000).optional(),
		// Opaque keyset cursor — pass back exactly the `next_cursor`
		// returned on the previous page; never hand-craft. When omitted,
		// the page starts from the most-recently-updated row.
		cursor: z.string().optional(),
	})
	.refine((filter) => (filter.config_root === undefined) === (filter.project_id === undefined), {
		message: "config_root and project_id must be provided together",
		path: ["project_id"],
	});

export type TaskListFilter = z.infer<typeof TaskListFilterSchema>;
