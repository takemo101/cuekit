import { resolve } from "node:path";
import { discoverAgentProfiles } from "@cuekit/agent-profiles";
import { JobErrorSchema, type TaskSpec, TaskSpecSchema } from "@cuekit/core";
import { getSessionById } from "@cuekit/store";
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

function resolveExplicitRole(
	ctx: CommandContext,
	input: SubmitTaskInput,
	session_id: string,
): { ok: true; specPatch: Partial<TaskSpec> } | { ok: false; output: SubmitTaskOutput } {
	if (!input.role) return { ok: true, specPatch: {} };
	if (input.role === "auto") return { ok: true, specPatch: {} };
	const cwd = input.session_id ? sessionCwd(ctx, session_id) : input.cwd;
	if (typeof cwd !== "string" && cwd !== undefined) return { ok: false, output: cwd };
	const discovered = discoverAgentProfiles({ cwd });
	if (!discovered.ok) return { ok: false, output: invalidInput(discovered.error) };
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
	const agent_kind = input.agent_kind ?? profile.agent_kind;
	if (!agent_kind) {
		return { ok: false, output: invalidInput(`role '${profile.id}' does not define agent_kind`) };
	}
	return {
		ok: true,
		specPatch: {
			agent_kind,
			model: input.model ?? profile.model,
			role: profile.id,
			role_instructions: profile.instructions,
			role_source: profile.source,
			role_sources: profile.sources,
			role_selection_reason: `explicit role '${profile.id}'`,
		},
	};
}

export async function runSubmitTask(
	ctx: CommandContext,
	input: SubmitTaskInput,
): Promise<SubmitTaskOutput> {
	const session_id = resolveSessionId(ctx.db, {
		session_id: input.session_id,
		cwd: input.cwd,
	});
	const roleResolution = resolveExplicitRole(ctx, input, session_id);
	if (!roleResolution.ok) return roleResolution.output;
	const { session_id: _ignored, ...rawSpec } = input;
	const unresolvedSpec = {
		...rawSpec,
		...roleResolution.specPatch,
		...(rawSpec.cwd !== undefined ? { cwd: resolve(rawSpec.cwd) } : {}),
	};
	const parsedSpec = TaskSpecSchema.safeParse(unresolvedSpec);
	if (!parsedSpec.success) {
		return invalidInput(parsedSpec.error.issues.map((issue) => issue.message).join("; "));
	}
	const spec = parsedSpec.data;
	const adapterRes = ctx.registry.require(spec.agent_kind);
	if (!adapterRes.ok) {
		return { accepted: false, error: adapterRes.error };
	}
	const result = await adapterRes.value.submit({ spec, session_id });
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
	};
}
