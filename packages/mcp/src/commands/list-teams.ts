import { resolve } from "node:path";
import { encodeTaskListCursor, JobErrorSchema, TeamSummarySchema } from "@cuekit/core";
import { listTasksByTeam, listTaskTeams } from "@cuekit/store";
import { z } from "incur";
import type { CommandContext } from "../command-context.ts";
import { buildTeamSummary } from "../team-status.ts";

export const ListTeamsInputSchema = z.object({
	session_id: z.string().min(1).optional(),
	cwd: z.string().min(1).optional(),
	limit: z.number().int().positive().max(500).optional(),
	cursor: z.string().min(1).optional(),
});

export type ListTeamsInput = z.infer<typeof ListTeamsInputSchema>;

export const ListTeamsOutputSchema = z.object({
	teams: z.array(TeamSummarySchema),
	has_more: z.boolean(),
	next_cursor: z.string().optional(),
	error: JobErrorSchema.optional(),
});
export type ListTeamsOutput = z.infer<typeof ListTeamsOutputSchema>;

export function runListTeams(ctx: CommandContext, input: ListTeamsInput = {}): ListTeamsOutput {
	if (input.session_id && input.cwd) {
		return {
			teams: [],
			has_more: false,
			error: {
				code: "invalid_input",
				message: "list_teams accepts only one scope: session_id or cwd",
				retryable: false,
			},
		};
	}
	try {
		const limit = input.limit ?? 100;
		const cwd = input.cwd === undefined ? undefined : resolve(input.cwd);
		const rows = listTaskTeams(ctx.db, { ...input, cwd, limit: limit + 1 });
		const page = rows.slice(0, limit);
		const summaries = page.map((team) => buildTeamSummary(team, listTasksByTeam(ctx.db, team.id)));
		const has_more = rows.length > limit;
		const last = page.at(-1);
		return {
			teams: summaries,
			has_more,
			...(has_more && last
				? { next_cursor: encodeTaskListCursor({ updated_at: last.updated_at, id: last.id }) }
				: {}),
		};
	} catch (error) {
		return {
			teams: [],
			has_more: false,
			error: {
				code: "invalid_input",
				message: error instanceof Error ? error.message : "invalid list_teams input",
				retryable: false,
			},
		};
	}
}
