import { z } from "zod";
import { TaskStatusSchema } from "./task-status.ts";

export const TaskListFilterSchema = z.object({
	status: TaskStatusSchema.optional(),
	agent_kind: z.string().optional(),
	session_id: z.string().optional(),
	cwd: z.string().optional(),
});

export type TaskListFilter = z.infer<typeof TaskListFilterSchema>;
