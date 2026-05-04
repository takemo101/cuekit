import { deleteTaskTeam, getTaskTeamById, listTasksByTeam } from "@cuekit/store";
import { z } from "incur";
import type { CommandContext } from "../command-context.ts";

export const DeleteTeamInputSchema = z.object({
	team_id: z.string().min(1),
});
export type DeleteTeamInput = z.infer<typeof DeleteTeamInputSchema>;

export const DeleteTeamOutputSchema = z.union([
	z.object({
		ok: z.literal(true),
		team_id: z.string(),
	}),
	z.object({
		error: z.object({
			code: z.enum(["team_not_found", "team_not_empty"]),
			message: z.string(),
		}),
	}),
]);
export type DeleteTeamOutput = z.infer<typeof DeleteTeamOutputSchema>;

export function runDeleteTeam(ctx: CommandContext, input: DeleteTeamInput): DeleteTeamOutput {
	const team = getTaskTeamById(ctx.db, input.team_id);
	if (!team) {
		return {
			error: {
				code: "team_not_found",
				message: `Team not found: ${input.team_id}`,
			},
		};
	}

	const tasks = listTasksByTeam(ctx.db, team.id);
	if (tasks.length > 0) {
		return {
			error: {
				code: "team_not_empty",
				message: `Team ${team.id} still has ${tasks.length} task(s); cleanup or delete tasks first.`,
			},
		};
	}

	deleteTaskTeam(ctx.db, team.id);
	return { ok: true, team_id: team.id };
}
