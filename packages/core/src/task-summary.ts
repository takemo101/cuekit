import { z } from "zod";
import { TaskStatusSchema } from "./task-status.ts";
import { TeamPositionSchema } from "./team.ts";

export const TaskSummarySchema = z.object({
	task_id: z.string().min(1),
	agent_kind: z.string().min(1),
	model: z.string().min(1).optional(),
	role: z.string().min(1).optional(),
	role_source: z.string().min(1).optional(),
	role_selection_reason: z.string().min(1).optional(),
	status: TaskStatusSchema,
	team_id: z.string().min(1).optional(),
	position: TeamPositionSchema.optional(),
	summary: z.string().optional(),
	updated_at: z.string().datetime({ offset: true }),
});

export type TaskSummary = z.infer<typeof TaskSummarySchema>;
