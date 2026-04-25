import { TaskStatusSchema } from "@cuekit/core";
import { z } from "zod";

// Schema for a raw row pulled out of the `tasks` table. Nullable fields match
// SQLite's representation — absent values come back as `null`.
export const TaskSchema = z.object({
	id: z.string().min(1),
	session_id: z.string().min(1),
	parent_task_id: z.string().min(1).nullable(),
	agent_kind: z.string().min(1),
	model: z.string().min(1).nullable(),
	objective: z.string().min(1),
	status: TaskStatusSchema,
	native_task_ref: z.string().min(1).nullable(),
	summary: z.string().nullable(),
	result_ref: z.string().min(1).nullable(),
	transcript_ref: z.string().min(1).nullable(),
	created_at: z.string().datetime({ offset: true }),
	updated_at: z.string().datetime({ offset: true }),
	started_at: z.string().datetime({ offset: true }).nullable(),
	completed_at: z.string().datetime({ offset: true }).nullable(),
});

export type Task = z.infer<typeof TaskSchema>;
