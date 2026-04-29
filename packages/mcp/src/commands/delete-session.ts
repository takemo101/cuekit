import { AckSchema, isTerminalTaskStatus } from "@cuekit/core";
import { deleteSession, getSessionById, listTasksBySession } from "@cuekit/store";
import { z } from "incur";
import type { CommandContext } from "../command-context.ts";

// Removes a session and all of its tasks in one transaction. Policy:
// every child task must be terminal — any running / queued task
// blocks the delete, so a caller can't accidentally drop live work.
// The caller cancels those tasks explicitly before retrying.
//
// Does not touch on-disk artifact directories; operators that want
// full cleanup remove those themselves.

export const DeleteSessionInputSchema = z.object({
	session_id: z.string().min(1).describe("cuekit session id."),
});

export type DeleteSessionInput = z.infer<typeof DeleteSessionInputSchema>;

export const DeleteSessionOutputSchema = AckSchema;
export type DeleteSessionOutput = z.infer<typeof DeleteSessionOutputSchema>;

export async function runDeleteSession(
	ctx: CommandContext,
	input: DeleteSessionInput,
): Promise<DeleteSessionOutput> {
	const session = getSessionById(ctx.db, input.session_id);
	if (!session) {
		return {
			ok: false,
			error: {
				code: "session_not_found",
				message: `session '${input.session_id}' not found`,
				retryable: false,
			},
		};
	}
	const tasks = listTasksBySession(ctx.db, input.session_id);
	const active = tasks.filter((t) => !isTerminalTaskStatus(t.status));
	if (active.length > 0) {
		return {
			ok: false,
			error: {
				code: "invalid_state",
				message: `session '${input.session_id}' has ${active.length} active task(s); cancel them before deleting`,
				retryable: false,
			},
		};
	}
	// Best-effort tmux cleanup for every task before wiping DB rows.  Once
	// the rows are gone we lose the task_ids, so cleanup must happen first.
	for (const task of tasks) {
		const adapter = ctx.registry.get(task.agent_kind);
		await adapter?.cleanup?.(task.id).catch(() => {});
	}
	deleteSession(ctx.db, input.session_id);
	return {
		ok: true,
		message: `deleted session '${input.session_id}' and ${tasks.length} task(s)`,
	};
}
