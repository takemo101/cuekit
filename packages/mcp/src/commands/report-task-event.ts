import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { HookDispatcher } from "@cuekit/adapters";
import { type JobError, JobErrorSchema, TaskSpecSchema, type TaskStatus } from "@cuekit/core";
import { appendTaskEvent, getTaskById, type Task, updateTaskStatus } from "@cuekit/store";
import { z } from "incur";
import { cleanupAdapterTask } from "../adapter-cleanup.ts";
import type { CommandContext } from "../command-context.ts";
import { fireTeamCompleteHookIfDone } from "../team-hooks.ts";

const REPORT_TYPES = [
	"progress",
	"completed",
	"failed",
	"blocked",
	"help_requested",
	"log",
] as const;
type ReportType = (typeof REPORT_TYPES)[number];

const TERMINAL_REPORT_STATUS: Partial<Record<ReportType, TaskStatus>> = {
	completed: "completed",
	failed: "failed",
	blocked: "blocked",
};

export const ReportTaskEventInputSchema = z.object({
	task_id: z.string().min(1).optional().describe("cuekit task id. Defaults to CUEKIT_TASK_ID."),
	child_token: z
		.string()
		.min(1)
		.optional()
		.describe("raw child reporting token. Defaults to CUEKIT_CHILD_TOKEN."),
	type: z.enum(REPORT_TYPES).describe("child report event type."),
	message: z.string().min(1).optional().describe("human-readable child report message."),
	payload: z.unknown().optional().describe("optional JSON payload for structured report details."),
});

export type ReportTaskEventInput = z.infer<typeof ReportTaskEventInputSchema>;

export const ReportTaskEventOutputSchema = z.discriminatedUnion("ok", [
	z.object({
		ok: z.literal(true),
		task_id: z.string(),
		event_id: z.string(),
		type: z.enum(REPORT_TYPES),
		status: z.string().optional(),
	}),
	z.object({
		ok: z.literal(false),
		error: JobErrorSchema,
	}),
]);

export type ReportTaskEventOutput = z.infer<typeof ReportTaskEventOutputSchema>;

function error(
	code: JobError["code"],
	message: string,
	details?: Record<string, unknown>,
): ReportTaskEventOutput {
	return { ok: false, error: { code, message, retryable: false, ...(details ? { details } : {}) } };
}

function sha256TokenHash(rawToken: string): string {
	return `sha256:${createHash("sha256").update(rawToken).digest("hex")}`;
}

function hashesMatch(expected: string, actual: string): boolean {
	const expectedBuffer = Buffer.from(expected);
	const actualBuffer = Buffer.from(actual);
	if (expectedBuffer.length !== actualBuffer.length) return false;
	return timingSafeEqual(expectedBuffer, actualBuffer);
}

// Read `adapter_options.cleanup_on_terminal_report` from the task's stored
// spec. The JSON / schema may be missing or malformed (older rows, future
// shape changes); treat any failure as the option being absent rather than
// rolling back a successful terminal report.
function cleanupOnTerminalReportFor(task: Task): boolean {
	if (!task.spec_json) return false;
	try {
		const spec = TaskSpecSchema.parse(JSON.parse(task.spec_json));
		return spec.adapter_options?.cleanup_on_terminal_report === true;
	} catch {
		return false;
	}
}

function normalizePayload(
	payload: unknown,
): { ok: true; value: unknown } | { ok: false; message: string } {
	if (typeof payload !== "string") return { ok: true, value: payload };
	const trimmed = payload.trim();
	if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return { ok: true, value: payload };
	try {
		return { ok: true, value: JSON.parse(trimmed) as unknown };
	} catch {
		return { ok: false, message: "payload must be valid JSON when it starts with '{' or '['" };
	}
}

export async function runReportTaskEvent(
	ctx: CommandContext,
	input: ReportTaskEventInput,
): Promise<ReportTaskEventOutput> {
	const task_id = input.task_id ?? process.env.CUEKIT_TASK_ID;
	const task_id_source = input.task_id ? "input.task_id" : "env:CUEKIT_TASK_ID";
	const child_token = input.child_token ?? process.env.CUEKIT_CHILD_TOKEN;
	const child_token_source = input.child_token ? "input.child_token" : "env:CUEKIT_CHILD_TOKEN";
	if (!task_id) return error("invalid_input", "task_id is required (or set CUEKIT_TASK_ID)");
	if (!child_token) {
		return error("invalid_input", "child_token is required (or set CUEKIT_CHILD_TOKEN)");
	}

	const task = getTaskById(ctx.db, task_id);
	if (!task) {
		return error("task_not_found", `task '${task_id}' not found`, {
			task_id,
			task_id_source,
			child_token_source,
			has_child_token: true,
			db_path: ctx.db.filename,
			cwd: process.cwd(),
		});
	}
	if (!task.child_token_hash) {
		return error("permission_denied", `task '${task_id}' has no child reporting token`);
	}
	if (!hashesMatch(task.child_token_hash, sha256TokenHash(child_token))) {
		return error("permission_denied", "invalid child reporting token");
	}
	const payload = normalizePayload(input.payload);
	if (!payload.ok) return error("invalid_input", payload.message);

	const event_id = `e_${randomUUID()}`;
	try {
		ctx.db.transaction(() => {
			appendTaskEvent(ctx.db, {
				id: event_id,
				task_id,
				type: input.type,
				message: input.message ?? null,
				payload: payload.value,
			});
			const terminalStatus = TERMINAL_REPORT_STATUS[input.type];
			const shouldFireTerminalHook = terminalStatus !== undefined && task.status !== terminalStatus;
			if (terminalStatus) updateTaskStatus(ctx.db, task_id, terminalStatus);
			// Fire hooks for terminal self-reports so that notifications
			// trigger even when the child reports its own completion. Same-status
			// duplicate reports append events but do not represent a new transition.
			if (shouldFireTerminalHook && ctx.hooks) {
				const updated = getTaskById(ctx.db, task_id);
				const event = HookDispatcher.taskEventName(terminalStatus);
				if (updated && event) {
					const env = HookDispatcher.taskEnv(updated);
					env.CUEKIT_EVENT = event;
					ctx.hooks.fire(event, env);
				}
			}
		})();
	} catch (cause) {
		return error(
			"invalid_state",
			cause instanceof Error ? cause.message : "failed to report task event",
		);
	}

	const updated = getTaskById(ctx.db, task_id);
	if (TERMINAL_REPORT_STATUS[input.type] && updated?.team_id) {
		fireTeamCompleteHookIfDone(ctx, updated.team_id);
	}

	// Opt-in pane cleanup. The default contract is "reporting does not close
	// your pane or process"; setting `adapter_options.cleanup_on_terminal_report`
	// to true at submit time tells cuekit to kill the adapter (e.g. tmux
	// session for pane adapters) the moment a terminal report lands. Cleanup
	// failure is logged but does NOT roll back the report itself — the
	// terminal status is already committed and clients should see ok:true.
	if (TERMINAL_REPORT_STATUS[input.type] && updated && cleanupOnTerminalReportFor(updated)) {
		const cleanup = await cleanupAdapterTask(ctx, updated);
		if (!cleanup.ok) {
			console.error(
				`cuekit report_task_event: post-report cleanup failed for task '${task_id}': ${cleanup.error.message}`,
			);
		}
	}

	return {
		ok: true,
		task_id,
		event_id,
		type: input.type,
		...(updated ? { status: updated.status } : {}),
	};
}
