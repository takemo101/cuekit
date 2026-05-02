import { resolve } from "node:path";
import { discoverAgentProfiles, selectAgentProfile } from "@cuekit/agent-profiles";
import { JobErrorSchema, type TaskSpec, TaskSpecSchema, TeamPositionSchema } from "@cuekit/core";
import {
	applySafeAdapterOptions,
	applySubmitDefaults,
	type CuekitProjectConfig,
	loadProjectConfig,
	shouldForceSafeAdapterOptions,
} from "@cuekit/project-config";
import { getSessionById, getTaskTeamById } from "@cuekit/store";
import { z } from "incur";
import type { CommandContext } from "../command-context.ts";
import { resolveSessionId } from "../session-helpers.ts";

export const SubmitTaskInputSchema = TaskSpecSchema.extend({
	agent_kind: z.string().min(1).optional(),
	role: z.string().min(1).optional(),
	session_id: z
		.string()
		.min(1)
		.optional()
		.describe("cuekit session id. Auto-created from cwd when omitted."),
	team_id: z.string().min(1).optional(),
	position: TeamPositionSchema.optional(),
});

export type SubmitTaskInput = z.infer<typeof SubmitTaskInputSchema>;

export const SubmitTaskOutputSchema = z.discriminatedUnion("accepted", [
	z.object({
		accepted: z.literal(true),
		task_id: z.string(),
		agent_kind: z.string(),
		session_id: z.string(),
		role: z.string().optional(),
		role_selection_reason: z.string().optional(),
		team_id: z.string().optional(),
		position: TeamPositionSchema.optional(),
	}),
	z.object({
		accepted: z.literal(false),
		error: JobErrorSchema,
	}),
]);

export type SubmitTaskOutput = z.infer<typeof SubmitTaskOutputSchema>;

function invalidInput(message: string): SubmitTaskOutput {
	return { accepted: false, error: { code: "invalid_input", message, retryable: false } };
}

function sessionCwd(
	ctx: CommandContext,
	session_id: string,
): string | undefined | SubmitTaskOutput {
	const session = getSessionById(ctx.db, session_id);
	if (!session) {
		return {
			accepted: false,
			error: {
				code: "session_not_found",
				message: `session '${session_id}' not found`,
				retryable: false,
			},
		};
	}
	return session.worktree_path;
}

function patchForProfile(
	input: SubmitTaskInput,
	profile: NonNullable<ReturnType<typeof selectAgentProfile>>["profile"],
	reason: string,
): { ok: true; specPatch: Partial<TaskSpec> } | { ok: false; output: SubmitTaskOutput } {
	return {
		ok: true,
		specPatch: {
			...(profile.agent_kind ? { agent_kind: profile.agent_kind } : {}),
			...((input.model ?? profile.model) ? { model: input.model ?? profile.model } : {}),
			role: profile.id,
			role_instructions: profile.instructions,
			role_source: profile.source,
			role_sources: profile.sources,
			role_selection_reason: reason,
		},
	};
}

function loadSubmitConfig(
	cwd: string | undefined,
): { ok: true; config: CuekitProjectConfig } | { ok: false; output: SubmitTaskOutput } {
	const loaded = loadProjectConfig(cwd ?? process.cwd());
	if (!loaded.ok) return { ok: false, output: invalidInput(loaded.error) };
	return { ok: true, config: loaded.config };
}

function resolveExplicitRole(
	ctx: CommandContext,
	input: SubmitTaskInput,
	session_id: string,
): { ok: true; specPatch: Partial<TaskSpec> } | { ok: false; output: SubmitTaskOutput } {
	if (!input.role) return { ok: true, specPatch: {} };
	const cwd = input.session_id ? sessionCwd(ctx, session_id) : input.cwd;
	if (typeof cwd !== "string" && cwd !== undefined) return { ok: false, output: cwd };
	const discovered = discoverAgentProfiles({ cwd });
	if (!discovered.ok) return { ok: false, output: invalidInput(discovered.error) };
	if (input.role === "auto") {
		const selected = selectAgentProfile({
			objective: input.objective,
			context: input.context,
			profiles: discovered.profiles,
		});
		if (!selected) return { ok: false, output: invalidInput("no agent profiles available") };
		return patchForProfile(input, selected.profile, selected.reason);
	}
	const profile = discovered.profiles.find((candidate) => candidate.id === input.role);
	if (!profile) {
		return {
			ok: false,
			output: invalidInput(
				`unknown role '${input.role}'. Available roles: ${discovered.profiles
					.map((candidate) => candidate.id)
					.join(", ")}`,
			),
		};
	}
	return patchForProfile(input, profile, `explicit role '${profile.id}'`);
}

function resolveTeam(
	ctx: CommandContext,
	session_id: string,
	input: SubmitTaskInput,
): { ok: true; specPatch: Partial<TaskSpec> } | { ok: false; output: SubmitTaskOutput } {
	if (!input.team_id) return { ok: true, specPatch: {} };
	const team = getTaskTeamById(ctx.db, input.team_id);
	if (!team) {
		return {
			ok: false,
			output: {
				accepted: false,
				error: {
					code: "team_not_found",
					message: `team '${input.team_id}' not found`,
					retryable: false,
				},
			},
		};
	}
	if (team.session_id !== session_id) {
		return {
			ok: false,
			output: invalidInput(
				`team '${input.team_id}' belongs to session '${team.session_id}', not '${session_id}'`,
			),
		};
	}
	return {
		ok: true,
		specPatch: {
			team_context: {
				team_id: team.id,
				title: team.title,
				...(team.objective ? { objective: team.objective } : {}),
				...(input.position ? { position: input.position } : {}),
			},
		},
	};
}

export async function runSubmitTask(
	ctx: CommandContext,
	input: SubmitTaskInput,
): Promise<SubmitTaskOutput> {
	const parsedInput = SubmitTaskInputSchema.safeParse(input);
	if (!parsedInput.success) {
		return invalidInput(parsedInput.error.issues.map((issue) => issue.message).join("; "));
	}
	input = parsedInput.data;
	if (input.position && !input.team_id) {
		return invalidInput("position requires team_id");
	}
	const sessionResolution = resolveSessionId(ctx.db, {
		session_id: input.session_id,
		cwd: input.cwd,
	});
	if (!sessionResolution.ok) {
		return { accepted: false, error: sessionResolution.error };
	}
	const session_id = sessionResolution.session_id;
	const configCwd = input.session_id ? sessionCwd(ctx, session_id) : input.cwd;
	if (typeof configCwd !== "string" && configCwd !== undefined) return configCwd;
	const configResult = loadSubmitConfig(configCwd);
	if (!configResult.ok) return configResult.output;
	const submitDefaults = applySubmitDefaults(input, configResult.config);
	input = { ...input, ...(submitDefaults.role ? { role: submitDefaults.role } : {}) };
	const teamResolution = resolveTeam(ctx, session_id, input);
	if (!teamResolution.ok) return teamResolution.output;
	const roleResolution = resolveExplicitRole(ctx, input, session_id);
	if (!roleResolution.ok) return roleResolution.output;
	const { session_id: _ignored, team_id, position, ...rawSpec } = input;
	const agent_kind =
		rawSpec.agent_kind ?? roleResolution.specPatch.agent_kind ?? submitDefaults.agent_kind;
	const model = rawSpec.model ?? roleResolution.specPatch.model ?? submitDefaults.model;
	let unresolvedSpec: Partial<TaskSpec> = {
		...rawSpec,
		...roleResolution.specPatch,
		...teamResolution.specPatch,
		...(agent_kind ? { agent_kind } : {}),
		...(model ? { model } : {}),
		...((rawSpec.timeout_ms ?? submitDefaults.timeout_ms)
			? { timeout_ms: rawSpec.timeout_ms ?? submitDefaults.timeout_ms }
			: {}),
		...((rawSpec.priority ?? submitDefaults.priority)
			? { priority: rawSpec.priority ?? submitDefaults.priority }
			: {}),
		...(rawSpec.cwd !== undefined ? { cwd: resolve(rawSpec.cwd) } : {}),
	};
	if (
		agent_kind &&
		shouldForceSafeAdapterOptions({
			config: configResult.config,
			agent_kind,
			caller_supplied_adapter_options: rawSpec.adapter_options !== undefined,
			role_from_config: submitDefaults.role_from_config,
			agent_from_config:
				rawSpec.agent_kind === undefined && agent_kind === configResult.config.submit?.agent,
		})
	) {
		unresolvedSpec = applySafeAdapterOptions(unresolvedSpec);
	}
	const parsedSpec = TaskSpecSchema.safeParse(unresolvedSpec);
	if (!parsedSpec.success) {
		return invalidInput(parsedSpec.error.issues.map((issue) => issue.message).join("; "));
	}
	const spec = parsedSpec.data;
	const adapterRes = ctx.registry.require(spec.agent_kind);
	if (!adapterRes.ok) {
		return { accepted: false, error: adapterRes.error };
	}
	const result = await adapterRes.value.submit({ spec, session_id, team_id, position });
	if (!result.ok) {
		return { accepted: false, error: result.error };
	}
	return {
		accepted: true,
		task_id: result.value.task_id,
		agent_kind: spec.agent_kind,
		session_id,
		...(spec.role ? { role: spec.role } : {}),
		...(spec.role_selection_reason ? { role_selection_reason: spec.role_selection_reason } : {}),
		...(team_id ? { team_id } : {}),
		...(position ? { position } : {}),
	};
}
