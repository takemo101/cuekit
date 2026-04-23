import { z } from "zod";
import { ExpectedOutputSpecSchema } from "./expected-output.ts";
import { InputRefSchema } from "./input-ref.ts";

export const TaskSpecSchema = z.object({
	agent_kind: z.string().min(1),
	objective: z.string().min(1),
	model: z.string().optional(),
	adapter_options: z.record(z.unknown()).optional(),
	context: z.string().optional(),
	constraints: z.array(z.string()).optional(),
	inputs: z.array(InputRefSchema).optional(),
	expected_output: ExpectedOutputSpecSchema.optional(),
	cwd: z.string().optional(),
	timeout_ms: z.number().int().positive().optional(),
	priority: z.enum(["low", "normal", "high"]).optional(),
	metadata: z.record(z.unknown()).optional(),
});

export type TaskSpec = z.infer<typeof TaskSpecSchema>;
