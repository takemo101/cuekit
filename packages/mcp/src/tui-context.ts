import type { Database } from "bun:sqlite";
import type { AdapterRegistry } from "@cuekit/adapters";
import { getTaskById } from "@cuekit/store";
import type { CommandContext } from "./command-context.ts";
import { runCancelTasks } from "./commands/cancel-task.ts";
import { runDeleteTasks } from "./commands/delete-task.ts";
import { runGetTaskStatus } from "./commands/get-task-status.ts";
import { runListTaskEvents } from "./commands/list-task-events.ts";
import { runListTasks } from "./commands/list-tasks.ts";
import { runSteerTask } from "./commands/steer-task.ts";

export interface TuiProjectScope {
	project_uid?: string;
	project_root: string;
}

export interface TuiScopeOptions {
	projectRoot?: string;
	projectScope?: TuiProjectScope;
	all?: boolean;
}

export function createTuiContext(ctx: CommandContext, scope: TuiScopeOptions = {}) {
	return {
		listTasks: (input: Parameters<typeof runListTasks>[1]) =>
			runListTasks(ctx, {
				...input,
				...(scope.all
					? {}
					: scope.projectScope !== undefined
						? { project_scope: scope.projectScope }
						: scope.projectRoot === undefined
							? {}
							: { project_root: scope.projectRoot }),
			}),
		getTaskStatus: (taskId: string) => runGetTaskStatus(ctx, { task_id: taskId }),
		listTaskEvents: (taskId: string) => runListTaskEvents(ctx, { task_id: taskId }),
		cancelTask: (taskId: string) => runCancelTasks(ctx, { task_ids: [taskId] }),
		deleteTask: (taskId: string) => runDeleteTasks(ctx, { task_ids: [taskId] }),
		steerTask: (taskId: string, message: string) => runSteerTask(ctx, { task_id: taskId, message }),
		getTranscriptPath: (taskId: string) => getTaskById(ctx.db, taskId)?.transcript_ref ?? undefined,
	};
}

// Keep the structural type useful to callers without making @cuekit/tui a dependency of @cuekit/mcp.
export type TuiCommandContext = ReturnType<typeof createTuiContext>;

export function makeCommandContext(db: Database, registry: AdapterRegistry): CommandContext {
	return { db, registry };
}
