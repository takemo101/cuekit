import { isTerminalTaskStatus, JobErrorSchema } from "@cuekit/core";
import { deleteSession, getSessionById, listTasksBySession } from "@cuekit/store";
import { z } from "incur";
import type { CommandContext } from "../command-context.ts";
import { findFirstDuplicate } from "./_duplicates.ts";

export const DeleteSessionsInputSchema = z.object({
	session_ids: z
		.array(z.string().min(1))
		.min(1)
		.describe(
			"cuekit session ids to delete. Repeat flag for multiple: --session_ids s_a --session_ids s_b.",
		),
});

export type DeleteSessionsInput = z.infer<typeof DeleteSessionsInputSchema>;

const DeleteSessionItemSchema = z.object({
	session_id: z.string(),
	ok: z.boolean(),
	deleted_tasks: z.number().int().nonnegative().optional(),
	message: z.string().optional(),
	error: JobErrorSchema.optional(),
});

export const DeleteSessionsOutputSchema = z.discriminatedUnion("ok", [
	z.object({
		ok: z.literal(true),
		message: z.string().optional(),
		sessions: z.array(DeleteSessionItemSchema),
	}),
	z.object({
		ok: z.literal(false),
		error: JobErrorSchema,
		sessions: z.array(DeleteSessionItemSchema).optional(),
	}),
]);

export type DeleteSessionsOutput = z.infer<typeof DeleteSessionsOutputSchema>;

export async function runDeleteSessions(
	ctx: CommandContext,
	input: DeleteSessionsInput,
): Promise<DeleteSessionsOutput> {
	const duplicate = findFirstDuplicate(input.session_ids);
	if (duplicate) {
		return {
			ok: false,
			error: {
				code: "invalid_input",
				message: `duplicate session_id '${duplicate}'`,
				retryable: false,
			},
		};
	}

	const results: z.infer<typeof DeleteSessionItemSchema>[] = [];
	for (const sessionId of input.session_ids) {
		const session = getSessionById(ctx.db, sessionId);
		if (!session) {
			results.push({
				session_id: sessionId,
				ok: false,
				error: {
					code: "session_not_found",
					message: `session '${sessionId}' not found`,
					retryable: false,
				},
			});
			continue;
		}

		const tasks = listTasksBySession(ctx.db, sessionId);
		const active = tasks.filter((task) => !isTerminalTaskStatus(task.status));
		if (active.length > 0) {
			results.push({
				session_id: sessionId,
				ok: false,
				error: {
					code: "invalid_state",
					message: `session '${sessionId}' has ${active.length} active task(s); cancel them before deleting`,
					retryable: false,
				},
			});
			continue;
		}

		for (const task of tasks) {
			const adapter = ctx.registry.get(task.agent_kind);
			await adapter?.cleanup?.(task.id).catch(() => {});
		}
		deleteSession(ctx.db, sessionId);
		results.push({
			session_id: sessionId,
			ok: true,
			deleted_tasks: tasks.length,
			message: `deleted session '${sessionId}' and ${tasks.length} task(s)`,
		});
	}

	const failed = results.find((result) => !result.ok);
	if (failed?.error) return { ok: false, error: failed.error, sessions: results };
	return { ok: true, message: `deleted ${results.length} session(s)`, sessions: results };
}
