import { randomUUID } from "node:crypto";
import { type JobError, JobErrorSchema, TeamPositionSchema } from "@cuekit/core";
import { appendTeamEvent, getTaskTeamById, TeamEventTypeSchema } from "@cuekit/store";
import { z } from "incur";
import type { CommandContext } from "../command-context.ts";

export const ReportTeamEventInputSchema = z.object({
	team_id: z.string().min(1),
	task_id: z.string().min(1).optional(),
	position: TeamPositionSchema.optional(),
	event_type: TeamEventTypeSchema,
	message: z.string().min(1),
	payload: z.unknown().optional(),
});
export type ReportTeamEventInput = z.infer<typeof ReportTeamEventInputSchema>;

export const ReportTeamEventOutputSchema = z.discriminatedUnion("ok", [
	z.object({
		ok: z.literal(true),
		team_id: z.string(),
		event_id: z.string(),
		event_type: TeamEventTypeSchema,
	}),
	z.object({
		ok: z.literal(false),
		error: JobErrorSchema,
	}),
]);
export type ReportTeamEventOutput = z.infer<typeof ReportTeamEventOutputSchema>;

function error(
	code: JobError["code"],
	message: string,
	details?: Record<string, unknown>,
): ReportTeamEventOutput {
	return { ok: false, error: { code, message, retryable: false, ...(details ? { details } : {}) } };
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

export async function runReportTeamEvent(
	ctx: CommandContext,
	input: ReportTeamEventInput,
): Promise<ReportTeamEventOutput> {
	const team = getTaskTeamById(ctx.db, input.team_id);
	if (!team) {
		return error("team_not_found", `team '${input.team_id}' not found`, {
			team_id: input.team_id,
		});
	}
	const payload = normalizePayload(input.payload);
	if (!payload.ok) return error("invalid_input", payload.message);

	const event_id = `te_${randomUUID()}`;
	try {
		appendTeamEvent(ctx.db, {
			id: event_id,
			team_id: input.team_id,
			...(input.task_id ? { task_id: input.task_id } : {}),
			...(input.position ? { position: input.position } : {}),
			event_type: input.event_type,
			message: input.message,
			payload: payload.value,
		});
	} catch (cause) {
		return error(
			"invalid_input",
			cause instanceof Error ? cause.message : "failed to report team event",
		);
	}

	return {
		ok: true,
		team_id: input.team_id,
		event_id,
		event_type: input.event_type,
	};
}
