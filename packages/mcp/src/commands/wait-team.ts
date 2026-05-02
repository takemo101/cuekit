import { JobErrorSchema, TeamStatusSchema } from "@cuekit/core";
import { applyTeamWaitDefaults, loadProjectConfig } from "@cuekit/project-config";
import { getSessionById, getTaskTeamById, listTasksByTeam } from "@cuekit/store";
import { z } from "incur";
import type { CommandContext } from "../command-context.ts";
import { aggregateTeamStatus } from "../team-status.ts";
import { runWaitTasks, WaitModeSchema, WaitTaskSnapshotSchema } from "./wait-tasks.ts";

export const WaitTeamInputSchema = z.object({
	team_id: z.string().min(1),
	mode: WaitModeSchema.optional(),
	timeout_ms: z.number().int().min(0).optional(),
	poll_interval_ms: z.number().int().min(1).optional(),
	stop_on_failed: z.boolean().optional(),
	include_results: z.boolean().optional(),
	include_events: z.boolean().optional(),
	since_event_sequences: z.record(z.string(), z.number().int().min(0)).optional(),
});

export type WaitTeamInput = z.infer<typeof WaitTeamInputSchema>;

export const WaitTeamOutputSchema = z.object({
	team_id: z.string(),
	status: TeamStatusSchema,
	mode: WaitModeSchema,
	done: z.boolean(),
	timed_out: z.boolean(),
	scope: z.object({ team_id: z.string(), session_id: z.string().optional() }),
	tasks: z.array(WaitTaskSnapshotSchema),
	error: JobErrorSchema.optional(),
});

export type WaitTeamOutput = z.infer<typeof WaitTeamOutputSchema>;

export async function runWaitTeam(
	ctx: CommandContext,
	input: WaitTeamInput,
): Promise<WaitTeamOutput> {
	const team = getTaskTeamById(ctx.db, input.team_id);
	if (!team) {
		return {
			team_id: input.team_id,
			status: "empty",
			mode: input.mode ?? "all",
			done: false,
			timed_out: false,
			scope: { team_id: input.team_id },
			tasks: [],
			error: {
				code: "team_not_found",
				message: `team '${input.team_id}' not found`,
				retryable: false,
			},
		};
	}
	const session = getSessionById(ctx.db, team.session_id);
	if (!session) {
		return {
			team_id: team.id,
			status: "empty",
			mode: input.mode ?? "all",
			done: false,
			timed_out: false,
			scope: { team_id: team.id, session_id: team.session_id },
			tasks: [],
			error: {
				code: "session_not_found",
				message: `session '${team.session_id}' not found`,
				retryable: false,
			},
		};
	}
	const loadedConfig = loadProjectConfig(session.worktree_path);
	const teamWaitDefaults = loadedConfig.ok ? applyTeamWaitDefaults(input, loadedConfig.config) : {};
	const tasks = listTasksByTeam(ctx.db, team.id);
	if (tasks.length === 0) {
		return {
			team_id: team.id,
			status: "empty",
			mode: input.mode ?? "all",
			done: true,
			timed_out: false,
			scope: { team_id: team.id, session_id: team.session_id },
			tasks: [],
		};
	}
	const wait = await runWaitTasks(ctx, {
		task_ids: tasks.map((task) => task.id),
		session_id: team.session_id,
		mode: input.mode,
		timeout_ms: teamWaitDefaults.timeout_ms,
		poll_interval_ms: teamWaitDefaults.poll_interval_ms,
		stop_on_failed: input.stop_on_failed,
		include_results: input.include_results,
		include_events: input.include_events,
		since_event_sequences: input.since_event_sequences,
	});
	const latest = listTasksByTeam(ctx.db, team.id).filter((task) =>
		tasks.some((snapshotted) => snapshotted.id === task.id),
	);
	return {
		team_id: team.id,
		status: aggregateTeamStatus(latest),
		mode: wait.mode,
		done: wait.done,
		timed_out: wait.timed_out,
		scope: { team_id: team.id, session_id: team.session_id },
		tasks: wait.tasks,
		...(wait.error ? { error: wait.error } : {}),
	};
}
