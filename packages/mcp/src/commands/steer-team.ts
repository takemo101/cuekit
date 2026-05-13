import {
	isTerminalTaskStatus,
	JobErrorSchema,
	TaskStatusSchema,
	TeamPositionSchema,
} from "@cuekit/core";
import { getTaskTeamById, listTasksByTeam } from "@cuekit/store";
import { z } from "incur";
import type { CommandContext } from "../command-context.ts";
import { runSteerTask } from "./steer-task.ts";

export const SteerTeamInputSchema = z.object({
	team_id: z.string().min(1).describe("cuekit team id."),
	message: z.string().min(1).describe("Steering text to inject into each non-terminal team task."),
	position: TeamPositionSchema.optional().describe("Optional team position filter."),
	task_ids: z
		.array(z.string().min(1))
		.min(1)
		.optional()
		.describe("Optional explicit team task subset."),
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
	reason: z.enum(["terminal", "steering_unsupported"]),
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
	const allTasks = listTasksByTeam(ctx.db, team.id);
	const taskById = new Map(allTasks.map((task) => [task.id, task]));
	if (input.task_ids) {
		const seen = new Set<string>();
		for (const taskId of input.task_ids) {
			if (seen.has(taskId)) {
				return {
					ok: false,
					team_id: team.id,
					error: {
						code: "invalid_input",
						message: `duplicate task_id '${taskId}'`,
						retryable: false,
					},
				};
			}
			seen.add(taskId);
			if (!taskById.has(taskId)) {
				return {
					ok: false,
					team_id: team.id,
					error: {
						code: "invalid_input",
						message: `task '${taskId}' is not a member of team '${team.id}'`,
						retryable: false,
					},
				};
			}
		}
	}

	const selectedTasks = input.task_ids
		? input.task_ids.map((taskId) => taskById.get(taskId)).filter((task) => task !== undefined)
		: allTasks.filter((task) => !input.position || task.team_position === input.position);

	for (const task of selectedTasks) {
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
		} else if (ack.error.code === "steering_unsupported") {
			skipped.push({ task_id: task.id, status: task.status, reason: "steering_unsupported" });
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
