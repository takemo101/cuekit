import { z } from "zod";
import { ArtifactRefSchema } from "./artifact-ref.ts";
import { JobErrorSchema } from "./job-error.ts";
import { TaskStatusSchema } from "./task-status.ts";

// Two valid envelope shapes (mcp-api-spec §6.5):
//
//   • **success** — a real task: `task_id` + `agent_kind` +
//     `created_at` + `updated_at` are all present, `error` is absent.
//   • **error** — `task_id` + `status: "failed"` + `error` is the
//     minimum useful shape (e.g. `task_not_found`,
//     `permission_denied`); the success-only fields may be omitted.
//
// #46 made `agent_kind` / `created_at` / `updated_at` optional to
// stop the typed lie (earlier code filled them with `1970-01-01` /
// `"unknown"`). That fix dropped the lie but loosened the success
// envelope at the schema level — a buggy success could now omit
// timestamps and the validator wouldn't notice.
//
// The `.refine()` below restores the discrimination: every accepted
// view is **either** an error envelope **or** a complete success
// envelope. The contract test suite (`adapter-contract.test.ts`)
// asserts the running view's shape across all three adapters; this
// refine is the schema-level safety net for any future caller.
export const TaskStatusViewSchema = z
	.object({
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
	})
	.refine(
		(v) =>
			// Error envelope: `error` field carries the diagnosis. The
			// success-only fields are allowed to be absent.
			v.error !== undefined ||
			// Success envelope: all three success-only fields must be
			// populated together (no half-fabricated rows).
			(v.agent_kind !== undefined && v.created_at !== undefined && v.updated_at !== undefined),
		{
			message:
				"task status view must be either an error envelope (with `error`) or a complete success envelope (with `agent_kind`, `created_at`, and `updated_at`)",
		},
	);

export type TaskStatusView = z.infer<typeof TaskStatusViewSchema>;
