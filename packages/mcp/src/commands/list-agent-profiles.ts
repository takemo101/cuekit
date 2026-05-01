import { discoverAgentProfiles } from "@cuekit/agent-profiles";
import { JobErrorSchema } from "@cuekit/core";
import { getSessionById } from "@cuekit/store";
import { z } from "incur";
import type { CommandContext } from "../command-context.ts";

export const ListAgentProfilesInputSchema = z.object({
	scope: z.enum(["all", "builtin", "user", "project"]).optional().default("all"),
	cwd: z.string().min(1).optional(),
	session_id: z.string().min(1).optional(),
	include_instructions: z.boolean().optional().default(false),
});
export interface ListAgentProfilesInput {
	scope?: "all" | "builtin" | "user" | "project";
	cwd?: string;
	session_id?: string;
	include_instructions?: boolean;
}

const AgentProfileSummarySchema = z.object({
	id: z.string(),
	description: z.string(),
	agent_kind: z.string().optional(),
	model: z.string().optional(),
	tags: z.array(z.string()),
	source: z.enum(["builtin", "user", "project"]),
	sources: z.array(z.enum(["builtin", "user", "project"])),
	file_paths: z.array(z.string()),
	instructions: z.string().optional(),
});

export const ListAgentProfilesOutputSchema = z.union([
	z.object({ profiles: z.array(AgentProfileSummarySchema) }),
	z.object({ error: JobErrorSchema }),
]);
export type ListAgentProfilesOutput = z.infer<typeof ListAgentProfilesOutputSchema>;

export function runListAgentProfiles(
	ctx: CommandContext,
	input: ListAgentProfilesInput,
): ListAgentProfilesOutput {
	let cwd = input.cwd;
	if (input.session_id) {
		const session = getSessionById(ctx.db, input.session_id);
		if (!session) {
			return {
				error: {
					code: "session_not_found",
					message: `session '${input.session_id}' not found`,
					retryable: false,
				},
			};
		}
		cwd = session.worktree_path;
	}
	const discovered = discoverAgentProfiles({ cwd });
	if (!discovered.ok) {
		return {
			error: { code: "invalid_input", message: discovered.error, retryable: false },
		};
	}
	const scope = input.scope ?? "all";
	const includeInstructions = input.include_instructions ?? false;
	const profiles = discovered.profiles
		.filter((profile) => scope === "all" || profile.sources.includes(scope))
		.map((profile) => ({
			id: profile.id,
			description: profile.description,
			agent_kind: profile.agent_kind,
			model: profile.model,
			tags: profile.tags,
			source: profile.source,
			sources: profile.sources,
			file_paths: profile.file_paths,
			...(includeInstructions ? { instructions: profile.instructions } : {}),
		}));
	return { profiles };
}
