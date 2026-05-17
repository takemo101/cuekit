import type { Database } from "bun:sqlite";
import { isTerminalTaskStatus, JobErrorSchema, TeamStatusSchema } from "@cuekit/core";
import { applyTeamWaitDefaults, loadProjectConfig } from "@cuekit/project-config";
import { getSessionById, getTaskTeamById, listTasksByTeam, type Task } from "@cuekit/store";
import { z } from "incur";
import { cleanupHintForTeam } from "../cleanup-hints.ts";
import type { CommandContext } from "../command-context.ts";
import { fireTeamCompleteHookIfDone } from "../team-hooks.ts";
import {
	buildTeamRunSummary,
	emptyTeamRunSummary,
	TeamRunSummarySchema,
} from "../team-run-summary.ts";
import { aggregateTeamStatus, buildCoordinatorFinalizationHint } from "../team-status.ts";
import { sleep } from "./_sleep.ts";
import {
	runWaitTasks,
	WAIT_TIMEOUT_ACTION_HINT,
	WaitModeSchema,
	WaitTaskSnapshotSchema,
} from "./wait-tasks.ts";

export const WaitTeamInputSchema = z.object({
	team_id: z.string().min(1),
	mode: WaitModeSchema.optional(),
	timeout_ms: z.number().int().min(0).optional(),
	poll_interval_ms: z.number().int().min(1).optional(),
	stop_on_failed: z.boolean().optional(),
	include_results: z.boolean().optional(),
	include_events: z.boolean().optional(),
	since_event_sequences: z.record(z.string(), z.number().int().min(0)).optional(),
	since_team_sequence: z
		.number()
		.int()
		.min(0)
		.optional()
		.describe("Return lightweight response immediately if no new team events since this sequence."),
	follow_new_tasks: z
		.boolean()
		.optional()
		.describe("Refresh team membership while waiting so coordinator-created tasks are included."),
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
	run_summary: TeamRunSummarySchema,
	team_sequence: z.number().int().min(0).optional(),
	next_action_hint: z.string().optional(),
	cleanup_hint: z.string().optional(),
	error: JobErrorSchema.optional(),
});

export type WaitTeamOutput = z.infer<typeof WaitTeamOutputSchema>;

function teamWaitTimeoutHint(followNewTasks: boolean, baseHint = WAIT_TIMEOUT_ACTION_HINT): string {
	if (!followNewTasks) return baseHint;
	return `${baseHint} follow_new_tasks is enabled, so call wait again to continue polling current and newly created team tasks.`;
}

function combineWaitHints(...hints: Array<string | undefined>): string | undefined {
	return hints.filter(Boolean).join(" ") || undefined;
}

async function waitCurrentTeamTasks(
	ctx: CommandContext,
	input: WaitTeamInput,
	team: { id: string; session_id: string },
	timeout_ms: number | undefined,
	poll_interval_ms: number | undefined,
) {
	const tasks = listTasksByTeam(ctx.db, team.id);
	return runWaitTasks(ctx, {
		task_ids: tasks.map((task) => task.id),
		session_id: team.session_id,
		mode: input.mode,
		timeout_ms,
		poll_interval_ms,
		stop_on_failed: input.stop_on_failed,
		include_results: input.include_results,
		include_events: input.include_events,
		since_event_sequences: input.since_event_sequences,
	});
}

function getMaxTeamSequence(db: Database, teamId: string): number | null {
	const row = db
		.prepare(
			`select coalesce(max(te.team_sequence), 0) as max_seq
			from task_events te
			join tasks t on te.task_id = t.id
			where t.team_id = ?`,
		)
		.get(teamId) as { max_seq: number } | undefined;
	return row?.max_seq ?? null;
}

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
			run_summary: emptyTeamRunSummary(),
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
			run_summary: emptyTeamRunSummary(),
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
			run_summary: emptyTeamRunSummary(),
		};
	}

	// since_team_sequence: if no new events, return lightweight response immediately
	if (input.since_team_sequence !== undefined) {
		const maxSeq = getMaxTeamSequence(ctx.db, team.id);
		if (maxSeq !== null && maxSeq <= input.since_team_sequence) {
			const latest = listTasksByTeam(ctx.db, team.id);
			return {
				team_id: team.id,
				status: aggregateTeamStatus(latest),
				mode: input.mode ?? "all",
				done: false,
				timed_out: true,
				team_sequence: maxSeq,
				scope: { team_id: team.id, session_id: team.session_id },
				tasks: [],
				run_summary: emptyTeamRunSummary(),
			};
		}
	}

	let wait: Awaited<ReturnType<typeof runWaitTasks>>;
	let latest: Task[];
	if (input.follow_new_tasks) {
		const timeoutMs = teamWaitDefaults.timeout_ms ?? 300_000;
		const pollIntervalMs = teamWaitDefaults.poll_interval_ms ?? 2_000;
		const deadline = Date.now() + timeoutMs;
		for (;;) {
			wait = await waitCurrentTeamTasks(ctx, input, team, 0, pollIntervalMs);
			latest = listTasksByTeam(ctx.db, team.id);
			if (wait.done || Date.now() >= deadline) break;
			await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
		}
	} else {
		wait = await waitCurrentTeamTasks(
			ctx,
			input,
			team,
			teamWaitDefaults.timeout_ms,
			teamWaitDefaults.poll_interval_ms,
		);
		latest = listTasksByTeam(ctx.db, team.id).filter((task) =>
			tasks.some((snapshotted) => snapshotted.id === task.id),
		);
	}
	const terminalTaskCount = latest.filter((task) => isTerminalTaskStatus(task.status)).length;
	if (latest.length > 0 && terminalTaskCount === latest.length)
		fireTeamCompleteHookIfDone(ctx, team.id);
	const cleanupHint = cleanupHintForTeam(team.id, terminalTaskCount);
	const coordinatorFinalizationHint = buildCoordinatorFinalizationHint(latest);
	const nextActionHint = combineWaitHints(
		wait.timed_out
			? teamWaitTimeoutHint(input.follow_new_tasks ?? false, wait.next_action_hint)
			: undefined,
		coordinatorFinalizationHint,
	);
	return {
		team_id: team.id,
		status: aggregateTeamStatus(latest),
		mode: wait.mode,
		done: wait.done,
		timed_out: wait.timed_out,
		scope: { team_id: team.id, session_id: team.session_id },
		tasks: wait.tasks,
		run_summary: buildTeamRunSummary(ctx, latest),
		...(nextActionHint ? { next_action_hint: nextActionHint } : {}),
		...(cleanupHint ? { cleanup_hint: cleanupHint } : {}),
		...(input.since_team_sequence !== undefined
			? { team_sequence: getMaxTeamSequence(ctx.db, team.id) ?? 0 }
			: {}),
		...(wait.error ? { error: wait.error } : {}),
	};
}
