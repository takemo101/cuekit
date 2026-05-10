import type { Database } from "bun:sqlite";
import type { AdapterRegistry } from "@cuekit/adapters";
import { getTaskById } from "@cuekit/store";
import type { CommandContext } from "./command-context.ts";
import { runCancelTasks } from "./commands/cancel-task.ts";
import { runCleanupTeam } from "./commands/cleanup-team.ts";
import { runDeleteTasks } from "./commands/delete-task.ts";
import { runDeleteTeam } from "./commands/delete-team.ts";
import { runGetTaskStatus } from "./commands/get-task-status.ts";
import { runGetTeamStatus } from "./commands/get-team-status.ts";
import { runListTaskEvents } from "./commands/list-task-events.ts";
import { runListTasks } from "./commands/list-tasks.ts";
import { runListTeams } from "./commands/list-teams.ts";
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
		listTeams: (input: Parameters<typeof runListTeams>[1]) =>
			runListTeams(ctx, {
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
		getTeamStatus: (teamId: string) => runGetTeamStatus(ctx, { team_id: teamId }),
		listTaskEvents: (taskId: string) => runListTaskEvents(ctx, { task_id: taskId }),
		cancelTask: (taskId: string) => runCancelTasks(ctx, { task_ids: [taskId] }),
		deleteTask: (taskId: string) => runDeleteTasks(ctx, { task_ids: [taskId] }),
		steerTask: (taskId: string, message: string) => runSteerTask(ctx, { task_id: taskId, message }),
		cleanupTeam: async (teamId: string) => {
			const result = await runCleanupTeam(ctx, { team_id: teamId });
			if ("error" in result) return { ok: false as const, error: result.error };
			return {
				ok: true as const,
				message: `Cleaned up ${result.deleted.length} terminal task(s).`,
			};
		},
		deleteTeam: async (teamId: string) => {
			const result = runDeleteTeam(ctx, { team_id: teamId });
			if ("error" in result) {
				return {
					ok: false as const,
					error: {
						code: result.error.code === "team_not_found" ? "team_not_found" : "invalid_state",
						message: result.error.message,
						retryable: false,
					},
				};
			}
			return { ok: true as const, message: `Deleted team ${result.team_id}.` };
		},
		getTranscriptPath: (taskId: string) => getTaskById(ctx.db, taskId)?.transcript_ref ?? undefined,
		capturePane: ctx.panes
			? (taskId: string) => ctx.panes!.capturePane(taskId)
			: undefined,
	};
}

// Keep the structural type useful to callers without making @cuekit/tui a dependency of @cuekit/mcp.
export type TuiCommandContext = ReturnType<typeof createTuiContext>;

export function makeCommandContext(
	db: Database,
	registry: AdapterRegistry,
	panes?: import("@cuekit/adapters").MultiplexerBackend,
): CommandContext {
	return { db, registry, panes };
}
