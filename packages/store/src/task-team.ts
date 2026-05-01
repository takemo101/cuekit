import { z } from "zod";

export const TaskTeamRowSchema = z.object({
	id: z.string().min(1),
	session_id: z.string().min(1),
	title: z.string().min(1),
	objective: z.string().nullable(),
	metadata_json: z.string().nullable(),
	created_at: z.string().datetime({ offset: true }),
	updated_at: z.string().datetime({ offset: true }),
});

export type TaskTeamRow = z.infer<typeof TaskTeamRowSchema>;
