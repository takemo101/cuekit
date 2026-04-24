import { z } from "zod";
import { ArtifactRefSchema } from "./artifact-ref.ts";
import { JobErrorSchema } from "./job-error.ts";
import { TaskStatusSchema } from "./task-status.ts";

export const TaskStatusViewSchema = z.object({
	task_id: z.string().min(1),
	agent_kind: z.string().min(1),
	status: TaskStatusSchema,
	summary: z.string().optional(),
	progress_text: z.string().optional(),
	created_at: z.string().datetime({ offset: true }),
	updated_at: z.string().datetime({ offset: true }),
	started_at: z.string().datetime({ offset: true }).optional(),
	completed_at: z.string().datetime({ offset: true }).optional(),
	native_session_id: z.string().optional(),
	native_task_id: z.string().optional(),
	supports_steering: z.boolean().optional(),
	supports_attach: z.boolean().optional(),
	attach_hint: z.string().optional(),
	error: JobErrorSchema.optional(),
	artifacts: z.array(ArtifactRefSchema).optional(),
	metadata: z.record(z.unknown()).optional(),
});

export type TaskStatusView = z.infer<typeof TaskStatusViewSchema>;
