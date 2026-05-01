import { z } from "zod";
import { ExpectedOutputSpecSchema } from "./expected-output.ts";
import { InputRefSchema } from "./input-ref.ts";
import { TeamPositionSchema } from "./team.ts";

export const TaskSpecSchema = z.object({
	agent_kind: z.string().min(1),
	objective: z.string().min(1),
	model: z.string().min(1).optional(),
	role: z.string().min(1).optional(),
	role_instructions: z.string().min(1).optional(),
	role_source: z.enum(["builtin", "user", "project"]).optional(),
	role_sources: z.array(z.enum(["builtin", "user", "project"])).optional(),
	role_selection_reason: z.string().min(1).optional(),
	team_context: z
		.object({
			team_id: z.string().min(1),
			title: z.string().min(1),
			objective: z.string().min(1).optional(),
			position: TeamPositionSchema.optional(),
		})
		.optional(),
	adapter_options: z.record(z.string(), z.unknown()).optional(),
	context: z.string().min(1).optional(),
	constraints: z.array(z.string().min(1)).optional(),
	inputs: z.array(InputRefSchema).optional(),
	expected_output: ExpectedOutputSpecSchema.optional(),
	cwd: z.string().min(1).optional(),
	timeout_ms: z.number().int().positive().optional(),
	priority: z.enum(["low", "normal", "high"]).optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
});

export type TaskSpec = z.infer<typeof TaskSpecSchema>;
