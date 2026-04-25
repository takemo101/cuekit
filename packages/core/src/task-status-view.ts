import { z } from "zod";
import { ArtifactRefSchema } from "./artifact-ref.ts";
import { JobErrorSchema } from "./job-error.ts";
import { TaskStatusSchema } from "./task-status.ts";

// `agent_kind`, `created_at`, and `updated_at` are required for the
// **success envelope** (a real task that the store has a row for) but
// optional in the **error envelope** described by mcp-api-spec §6.5,
// where `task_id` + `status: "failed"` + `error` is the minimum useful
// shape (e.g. `task_not_found`). Earlier revisions filled them with
// fake values (`new Date().toISOString()`, `agent_kind: "unknown"`)
// so the schema would accept the error case — that was a typed lie
// callers couldn't distinguish from real timestamps. Optionality
// drops the lie at the cost of slightly looser success-path
// validation; success-path call sites already populate them so this
// doesn't relax what the wire actually carries.
export const TaskStatusViewSchema = z.object({
	task_id: z.string().min(1),
	agent_kind: z.string().min(1).optional(),
	status: TaskStatusSchema,
	summary: z.string().optional(),
	progress_text: z.string().optional(),
	created_at: z.string().datetime({ offset: true }).optional(),
	updated_at: z.string().datetime({ offset: true }).optional(),
	started_at: z.string().datetime({ offset: true }).optional(),
	completed_at: z.string().datetime({ offset: true }).optional(),
	native_session_id: z.string().optional(),
	native_task_id: z.string().optional(),
	supports_steering: z.boolean().optional(),
	supports_attach: z.boolean().optional(),
	attach_hint: z.string().optional(),
	error: JobErrorSchema.optional(),
	artifacts: z.array(ArtifactRefSchema).optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
});

export type TaskStatusView = z.infer<typeof TaskStatusViewSchema>;
