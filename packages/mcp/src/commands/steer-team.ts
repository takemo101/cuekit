import { isTerminalTaskStatus, JobErrorSchema, TaskStatusSchema } from "@cuekit/core";
import { getTaskTeamById, listTasksByTeam } from "@cuekit/store";
import { z } from "incur";
import type { CommandContext } from "../command-context.ts";
import { runSteerTask } from "./steer-task.ts";

export const SteerTeamInputSchema = z.object({
	team_id: z.string().min(1).describe("cuekit team id."),
	message: z.string().min(1).describe("Steering text to inject into each non-terminal team task."),
	reason: z.string().min(1).optional(),
});

export type SteerTeamInput = z.infer<typeof SteerTeamInputSchema>;

const SteeredTeamTaskSchema = z.object({
	task_id: z.string(),
	status: TaskStatusSchema,
});

const SkippedTeamTaskSchema = z.object({
	task_id: z.string(),
	status: TaskStatusSchema,
	reason: z.literal("terminal"),
});

const FailedTeamSteerSchema = z.object({
	task_id: z.string(),
	status: TaskStatusSchema,
	error: JobErrorSchema,
});

export const SteerTeamOutputSchema = z.union([
	z.object({
		ok: z.literal(true),
		team_id: z.string(),
		steered: z.array(SteeredTeamTaskSchema),
		skipped: z.array(SkippedTeamTaskSchema),
		failed: z.array(FailedTeamSteerSchema),
		message: z.string().optional(),
	}),
	z.object({
		ok: z.literal(false),
		team_id: z.string().optional(),
		steered: z.array(SteeredTeamTaskSchema).optional(),
		skipped: z.array(SkippedTeamTaskSchema).optional(),
		failed: z.array(FailedTeamSteerSchema).optional(),
		error: JobErrorSchema,
	}),
]);

export type SteerTeamOutput = z.infer<typeof SteerTeamOutputSchema>;

export async function runSteerTeam(
	ctx: CommandContext,
	input: SteerTeamInput,
): Promise<SteerTeamOutput> {
	const team = getTaskTeamById(ctx.db, input.team_id);
	if (!team) {
		return {
			ok: false,
			error: {
				code: "team_not_found",
				message: `team '${input.team_id}' not found`,
				retryable: false,
			},
		};
	}

	const steered: z.infer<typeof SteeredTeamTaskSchema>[] = [];
	const skipped: z.infer<typeof SkippedTeamTaskSchema>[] = [];
	const failed: z.infer<typeof FailedTeamSteerSchema>[] = [];

	for (const task of listTasksByTeam(ctx.db, team.id)) {
		if (isTerminalTaskStatus(task.status)) {
			skipped.push({ task_id: task.id, status: task.status, reason: "terminal" });
			continue;
		}

		const ack = await runSteerTask(ctx, {
			task_id: task.id,
			message: input.message,
			...(input.reason ? { reason: input.reason } : {}),
		});
		if (ack.ok) {
			steered.push({ task_id: task.id, status: task.status });
		} else {
			failed.push({ task_id: task.id, status: task.status, error: ack.error });
		}
	}

	if (failed.length > 0) {
		return {
			ok: false,
			team_id: team.id,
			steered,
			skipped,
			failed,
			error: {
				code: "transport_error",
				message: `failed to steer ${failed.length} of ${steered.length + failed.length} non-terminal team task(s)`,
				retryable: true,
			},
		};
	}

	return {
		ok: true,
		team_id: team.id,
		steered,
		skipped,
		failed,
		message: `steering message delivered to ${steered.length} non-terminal team task(s)`,
	};
}
