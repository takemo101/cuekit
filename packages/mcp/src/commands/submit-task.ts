import { JobErrorSchema, type TaskSpec, TaskSpecSchema } from "@cuekit/core";
import { z } from "incur";
import type { CommandContext } from "../command-context.ts";
import { resolveSessionId } from "../session-helpers.ts";

// Submit input is the protocol's `TaskSpec` plus an optional cuekit
// session id. Earlier this schema was hand-written and silently dropped
// `context`, `constraints`, `inputs`, and `expected_output` — the MCP
// spec's §5.2 input example showed all four, so callers using the spec
// as their guide had their fields disappear without warning. Deriving
// from `TaskSpecSchema` makes the relationship single-source-of-truth:
// any future protocol additions land here automatically.
export const SubmitTaskInputSchema = TaskSpecSchema.extend({
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
	}),
	z.object({
		accepted: z.literal(false),
		error: JobErrorSchema,
	}),
]);

export type SubmitTaskOutput = z.infer<typeof SubmitTaskOutputSchema>;

export async function runSubmitTask(
	ctx: CommandContext,
	input: SubmitTaskInput,
): Promise<SubmitTaskOutput> {
	const adapterRes = ctx.registry.require(input.agent_kind);
	if (!adapterRes.ok) {
		return { accepted: false, error: adapterRes.error };
	}
	const session_id = resolveSessionId(ctx.db, {
		session_id: input.session_id,
		cwd: input.cwd,
	});
	// Pull every TaskSpec field from input verbatim — including the
	// previously-dropped `context` / `constraints` / `inputs` /
	// `expected_output`. `session_id` is the only field that's *not*
	// part of TaskSpec, so we strip it explicitly here.
	const { session_id: _ignored, ...spec } = input satisfies TaskSpec & {
		session_id?: string;
	};
	const result = await adapterRes.value.submit({ spec, session_id });
	if (!result.ok) {
		return { accepted: false, error: result.error };
	}
	return {
		accepted: true,
		task_id: result.value.task_id,
		agent_kind: input.agent_kind,
		session_id,
	};
}
