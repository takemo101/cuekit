import { SessionStatusSchema } from "@cuekit/core";
import { z } from "zod";

// Schema for a raw row pulled out of the `sessions` table. Nullable fields
// (not optional) match SQLite's representation — absent values come back as
// JavaScript `null`, not `undefined`.
export const SessionSchema = z.object({
	id: z.string().min(1),
	project_root: z.string().min(1),
	worktree_path: z.string().min(1),
	parent_agent_kind: z.string().min(1),
	parent_session_ref: z.string().min(1).nullable(),
	status: SessionStatusSchema,
	created_at: z.string().datetime({ offset: true }),
	updated_at: z.string().datetime({ offset: true }),
	ended_at: z.string().datetime({ offset: true }).nullable(),
});

export type Session = z.infer<typeof SessionSchema>;
