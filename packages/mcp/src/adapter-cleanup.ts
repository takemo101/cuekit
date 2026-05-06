import type { JobError } from "@cuekit/core";
import type { Task } from "@cuekit/store";
import type { CommandContext } from "./command-context.ts";

export type AdapterCleanupResult = { ok: true } | { ok: false; error: JobError };

export async function cleanupAdapterTask(
	ctx: CommandContext,
	task: Pick<Task, "id" | "agent_kind">,
): Promise<AdapterCleanupResult> {
	const adapter = ctx.registry.get(task.agent_kind);
	if (!adapter?.cleanup) return { ok: true };
	try {
		await adapter.cleanup(task.id);
		return { ok: true };
	} catch (error) {
		return {
			ok: false,
			error: {
				code: "runtime_crash",
				message: `adapter cleanup failed for task '${task.id}'`,
				retryable: true,
				details: {
					task_id: task.id,
					agent_kind: task.agent_kind,
					cause: error instanceof Error ? error.message : String(error),
				},
			},
		};
	}
}
