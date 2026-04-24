import { JobErrorSchema, type TaskSpec } from "@cuekit/core";
import { z } from "incur";
import type { CommandContext } from "../command-context.ts";
import { resolveSessionId } from "../session-helpers.ts";

export const SubmitTaskInputSchema = z.object({
	objective: z.string().min(1).describe("What the child agent should accomplish."),
	agent_kind: z
		.string()
		.min(1)
		.describe("Target adapter kind (e.g. 'claude-code', 'pi', 'opencode')."),
	session_id: z
		.string()
		.min(1)
		.optional()
		.describe("cuekit session id. Auto-created from cwd when omitted."),
	model: z.string().min(1).optional().describe("Runtime model (e.g. 'sonnet')."),
	cwd: z.string().min(1).optional().describe("Working directory for the child runtime."),
	timeout_ms: z.number().int().positive().optional(),
	priority: z.enum(["low", "normal", "high"]).optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
	adapter_options: z
		.record(z.string(), z.unknown())
		.optional()
		.describe("Runtime-specific options bag (see the target adapter's docs)."),
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
	const spec: TaskSpec = {
		agent_kind: input.agent_kind,
		objective: input.objective,
		model: input.model,
		adapter_options: input.adapter_options,
		cwd: input.cwd,
		timeout_ms: input.timeout_ms,
		priority: input.priority,
		metadata: input.metadata,
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
