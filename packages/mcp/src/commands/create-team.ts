import { JobErrorSchema, TaskTeamSchema } from "@cuekit/core";
import { createTaskTeam, getSessionById } from "@cuekit/store";
import { z } from "incur";
import type { CommandContext } from "../command-context.ts";
import { resolveSessionId } from "../session-helpers.ts";

export const CreateTeamInputSchema = z.object({
	session_id: z.string().min(1).optional(),
	cwd: z.string().min(1).optional(),
	title: z.string().min(1),
	objective: z.string().min(1).optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
});

export type CreateTeamInput = z.infer<typeof CreateTeamInputSchema>;

export const CreateTeamOutputSchema = z.union([
	TaskTeamSchema,
	z.object({ error: JobErrorSchema }),
]);
export type CreateTeamOutput = z.infer<typeof CreateTeamOutputSchema>;

function generateTeamId(): string {
	return `tm_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export function runCreateTeam(ctx: CommandContext, input: CreateTeamInput): CreateTeamOutput {
	const parsed = CreateTeamInputSchema.safeParse(input);
	if (!parsed.success) {
		return {
			error: {
				code: "invalid_input",
				message: parsed.error.issues.map((issue) => issue.message).join("; "),
				retryable: false,
			},
		};
	}
	const session_id = resolveSessionId(ctx.db, {
		session_id: parsed.data.session_id,
		cwd: parsed.data.cwd,
	});
	if (!getSessionById(ctx.db, session_id)) {
		return {
			error: {
				code: "session_not_found",
				message: `session '${session_id}' not found`,
				retryable: false,
			},
		};
	}
	const row = createTaskTeam(ctx.db, {
		id: generateTeamId(),
		session_id,
		title: parsed.data.title,
		objective: parsed.data.objective,
		metadata: parsed.data.metadata,
	});
	return {
		team_id: row.id,
		session_id: row.session_id,
		title: row.title,
		...(row.objective ? { objective: row.objective } : {}),
		created_at: row.created_at,
		updated_at: row.updated_at,
		...(parsed.data.metadata ? { metadata: parsed.data.metadata } : {}),
	};
}
