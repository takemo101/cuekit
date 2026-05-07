import { resolve } from "node:path";
import {
	isTerminalTaskStatus,
	JobErrorSchema,
	TaskResultSchema,
	TaskStatusSchema,
} from "@cuekit/core";
import { getSessionById, getTaskById, listTaskEvents } from "@cuekit/store";
import { z } from "incur";
import { cleanupHintForTaskIds } from "../cleanup-hints.ts";
import type { CommandContext } from "../command-context.ts";
import { getTaskActivity } from "../task-activity.ts";
import { withTerminalReportSummaryFallback } from "../task-result-summary.ts";
import { findFirstDuplicate } from "./_duplicates.ts";
import { normalizeIdList } from "./_normalize-id-list.ts";
import { sleep } from "./_sleep.ts";

export const WaitModeSchema = z.enum(["all", "any"]);

export const TaskEventOutputSchema = z.object({
	sequence: z.number().int().positive(),
	id: z.string(),
	task_id: z.string(),
	type: z.string(),
	message: z.string().nullable(),
	payload: z.unknown().nullable(),
	created_at: z.string(),
});

export const WaitTaskSnapshotSchema = z.object({
	task_id: z.string(),
	status: TaskStatusSchema,
	terminal: z.boolean(),
	last_event_at: z.string().datetime({ offset: true }).optional(),
	last_transcript_at: z.string().datetime({ offset: true }).optional(),
	idle_ms: z.number().int().nonnegative().optional(),
	attention_hint: z.enum(["no_recent_activity", "stop_hook_or_idle_prompt_suspected"]).optional(),
	result: TaskResultSchema.optional(),
	events: z.array(TaskEventOutputSchema).optional(),
});

export const WaitTasksInputSchema = z.object({
	task_ids: z
		.array(z.string().min(1))
		.min(1)
		.describe(
			"cuekit task ids to wait for. Repeat flag for multiple (--task_ids t_a --task_ids t_b) or pass a comma-separated list (--task_ids t_a,t_b).",
		),
	session_id: z.string().min(1).optional().describe("Restrict waiting to this cuekit session."),
	cwd: z
		.string()
		.min(1)
		.optional()
		.describe(
			"Optional opt-in restriction: only wait on tasks whose session worktree matches this path. When omitted no implicit scope is applied (task_ids alone identifies the targets).",
		),
	mode: WaitModeSchema.optional().describe("Wait for all tasks or any one task. Defaults to all."),
	timeout_ms: z.number().int().min(0).optional().describe("Maximum time to wait in milliseconds."),
	poll_interval_ms: z
		.number()
		.int()
		.min(1)
		.optional()
		.describe("Polling interval in milliseconds."),
	stop_on_failed: z
		.boolean()
		.optional()
		.describe("In all mode, return early when any task reaches failed/blocked/timed_out."),
	include_results: z
		.boolean()
		.optional()
		.describe("Include normalized results for terminal tasks. Defaults to true."),
	include_events: z.boolean().optional().describe("Include child-reported task events."),
	since_event_sequences: z
		.record(z.string(), z.number().int().min(0))
		.optional()
		.describe("Per-task event sequence cursor; only larger sequence numbers are returned."),
});

export type WaitTasksInput = z.infer<typeof WaitTasksInputSchema>;

export const WaitTasksOutputSchema = z.object({
	mode: WaitModeSchema,
	done: z.boolean(),
	timed_out: z.boolean(),
	scope: z.object({ session_id: z.string().optional(), cwd: z.string().optional() }),
	tasks: z.array(WaitTaskSnapshotSchema),
	next_action_hint: z.string().optional(),
	cleanup_hint: z.string().optional(),
	error: JobErrorSchema.optional(),
});

export type WaitTasksOutput = z.infer<typeof WaitTasksOutputSchema>;

const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const FAILURE_LIKE_STATUSES = new Set(["failed", "blocked", "timed_out"]);
export const WAIT_TIMEOUT_ACTION_HINT =
	"Task is still running; poll again with a short timeout or inspect get_status for attention_hint.";

function waitTimeoutActionHint(snapshots: WaitTasksOutput["tasks"]): string {
	if (snapshots.some((task) => task.attention_hint === "stop_hook_or_idle_prompt_suspected")) {
		return `${WAIT_TIMEOUT_ACTION_HINT} One or more tasks appear idle at a prompt or stop hook; consider cuekit_steer asking them to report current status, blockers, and next action.`;
	}
	if (snapshots.some((task) => task.attention_hint === "no_recent_activity")) {
		return `${WAIT_TIMEOUT_ACTION_HINT} One or more tasks have no recent activity; consider cuekit_steer asking for a progress or terminal report, or cancel if no longer needed.`;
	}
	if (snapshots.some((task) => task.last_transcript_at || task.last_event_at)) {
		return `${WAIT_TIMEOUT_ACTION_HINT} Recent activity was observed; if progress stops, steer the task to report status or completion.`;
	}
	return WAIT_TIMEOUT_ACTION_HINT;
}

function cleanupHintForSnapshots(snapshots: WaitTasksOutput["tasks"]): string | undefined {
	return cleanupHintForTaskIds(
		snapshots.filter((task) => task.terminal).map((task) => task.task_id),
	);
}

function commandError(
	code: z.infer<typeof JobErrorSchema>["code"],
	message: string,
	tasks: WaitTasksOutput["tasks"] = [],
): WaitTasksOutput {
	return {
		mode: "all",
		done: false,
		timed_out: false,
		scope: {},
		tasks,
		error: { code, message, retryable: false },
	};
}

function normalizeCwd(inputCwd: string): string {
	return resolve(inputCwd);
}

async function validateScope(
	ctx: CommandContext,
	input: WaitTasksInput,
): Promise<{ ok: true; cwd?: string } | { ok: false; output: WaitTasksOutput }> {
	const duplicate = findFirstDuplicate(input.task_ids);
	if (duplicate) {
		return {
			ok: false,
			output: commandError("invalid_input", `duplicate task_id '${duplicate}'`),
		};
	}

	const cwd = input.cwd !== undefined ? normalizeCwd(input.cwd) : undefined;
	for (const taskId of input.task_ids) {
		const task = getTaskById(ctx.db, taskId);
		if (!task) {
			return {
				ok: false,
				output: commandError("task_not_found", `task '${taskId}' not found`),
			};
		}
		if (input.session_id && task.session_id !== input.session_id) {
			return {
				ok: false,
				output: commandError(
					"permission_denied",
					`task '${taskId}' is outside session '${input.session_id}'`,
				),
			};
		}
		const session = getSessionById(ctx.db, task.session_id);
		if (!session) {
			return {
				ok: false,
				output: commandError("session_not_found", `session '${task.session_id}' not found`),
			};
		}
		if (cwd && resolve(session.worktree_path) !== cwd) {
			return {
				ok: false,
				output: commandError("permission_denied", `task '${taskId}' is outside cwd '${cwd}'`),
			};
		}
	}
	return { ok: true, cwd };
}

async function snapshotTask(
	ctx: CommandContext,
	taskId: string,
	input: WaitTasksInput,
): Promise<WaitTasksOutput["tasks"][number] | { error: WaitTasksOutput["error"] }> {
	let task = getTaskById(ctx.db, taskId);
	if (!task) {
		return {
			error: { code: "task_not_found", message: `task '${taskId}' not found`, retryable: false },
		};
	}

	if (!isTerminalTaskStatus(task.status)) {
		const adapterRes = ctx.registry.require(task.agent_kind);
		if (!adapterRes.ok) return { error: adapterRes.error };
		await adapterRes.value.status(taskId);
		task = getTaskById(ctx.db, taskId);
		if (!task) {
			return {
				error: { code: "task_not_found", message: `task '${taskId}' not found`, retryable: false },
			};
		}
	}

	const terminal = isTerminalTaskStatus(task.status);
	const snapshot: WaitTasksOutput["tasks"][number] = {
		task_id: taskId,
		status: task.status,
		terminal,
		...getTaskActivity(ctx.db, task),
	};

	if (input.include_events) {
		const since = input.since_event_sequences?.[taskId] ?? 0;
		snapshot.events = listTaskEvents(ctx.db, taskId).filter((event) => event.sequence > since);
	}

	if ((input.include_results ?? true) && terminal) {
		const adapterRes = ctx.registry.require(task.agent_kind);
		if (!adapterRes.ok) return { error: adapterRes.error };
		const result = await adapterRes.value.collect(taskId);
		if (result.ok) snapshot.result = withTerminalReportSummaryFallback(ctx, result.value);
	}

	return snapshot;
}

function shouldReturn(
	snapshots: WaitTasksOutput["tasks"],
	mode: z.infer<typeof WaitModeSchema>,
	stopOnFailed: boolean,
): boolean {
	if (mode === "all" && snapshots.every((task) => task.terminal)) return true;
	if (mode === "any" && snapshots.some((task) => task.terminal)) return true;
	if (stopOnFailed && snapshots.some((task) => FAILURE_LIKE_STATUSES.has(task.status))) return true;
	return false;
}

export async function runWaitTasks(
	ctx: CommandContext,
	input: WaitTasksInput,
): Promise<WaitTasksOutput> {
	const taskIds = normalizeIdList(input.task_ids);
	if (taskIds.length === 0) {
		return commandError("invalid_input", "task_ids contained only empty values after splitting");
	}
	const normalizedInput: WaitTasksInput = { ...input, task_ids: taskIds };
	const mode = input.mode ?? "all";
	const timeoutMs = input.timeout_ms ?? DEFAULT_TIMEOUT_MS;
	const pollIntervalMs = input.poll_interval_ms ?? DEFAULT_POLL_INTERVAL_MS;
	const scoped = await validateScope(ctx, normalizedInput);
	if (!scoped.ok) return scoped.output;

	const scope = {
		...(input.session_id ? { session_id: input.session_id } : {}),
		...(scoped.cwd ? { cwd: scoped.cwd } : {}),
	};
	const deadline = Date.now() + timeoutMs;
	let latest: WaitTasksOutput["tasks"] = [];

	for (;;) {
		const snapshots: WaitTasksOutput["tasks"] = [];
		for (const taskId of normalizedInput.task_ids) {
			const snapshot = await snapshotTask(ctx, taskId, input);
			if ("error" in snapshot) {
				return {
					mode,
					done: false,
					timed_out: false,
					scope,
					tasks: snapshots,
					error: snapshot.error,
				};
			}
			snapshots.push(snapshot);
		}
		latest = snapshots;
		if (shouldReturn(snapshots, mode, input.stop_on_failed ?? false)) {
			const cleanupHint = cleanupHintForSnapshots(snapshots);
			return {
				mode,
				done: true,
				timed_out: false,
				scope,
				tasks: snapshots,
				...(cleanupHint ? { cleanup_hint: cleanupHint } : {}),
			};
		}
		if (Date.now() >= deadline) break;
		await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
	}

	const cleanupHint = cleanupHintForSnapshots(latest);
	return {
		mode,
		done: false,
		timed_out: true,
		scope,
		tasks: latest,
		next_action_hint: waitTimeoutActionHint(latest),
		...(cleanupHint ? { cleanup_hint: cleanupHint } : {}),
	};
}
