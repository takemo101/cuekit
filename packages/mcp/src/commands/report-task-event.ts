import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { type JobError, JobErrorSchema, type TaskStatus } from "@cuekit/core";
import { appendTaskEvent, getTaskById, updateTaskStatus } from "@cuekit/store";
import { z } from "incur";
import type { CommandContext } from "../command-context.ts";

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

function error(code: JobError["code"], message: string): ReportTaskEventOutput {
	return { ok: false, error: { code, message, retryable: false } };
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
	const child_token = input.child_token ?? process.env.CUEKIT_CHILD_TOKEN;
	if (!task_id) return error("invalid_input", "task_id is required (or set CUEKIT_TASK_ID)");
	if (!child_token) {
		return error("invalid_input", "child_token is required (or set CUEKIT_CHILD_TOKEN)");
	}

	const task = getTaskById(ctx.db, task_id);
	if (!task) return error("task_not_found", `task '${task_id}' not found`);
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
			if (terminalStatus) updateTaskStatus(ctx.db, task_id, terminalStatus);
		})();
	} catch (cause) {
		return error(
			"invalid_state",
			cause instanceof Error ? cause.message : "failed to report task event",
		);
	}

	const updated = getTaskById(ctx.db, task_id);
	return {
		ok: true,
		task_id,
		event_id,
		type: input.type,
		...(updated ? { status: updated.status } : {}),
	};
}
