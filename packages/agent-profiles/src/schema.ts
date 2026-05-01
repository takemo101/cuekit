import { z } from "zod";

export const AgentProfileSourceSchema = z.enum(["builtin", "user", "project"]);
export type AgentProfileSource = z.infer<typeof AgentProfileSourceSchema>;

export const InstructionsModeSchema = z.enum(["replace", "append"]);
export type InstructionsMode = z.infer<typeof InstructionsModeSchema>;

const AgentProfileIdSchema = z
	.string()
	.min(1)
	.refine((id) => id !== "auto", {
		message: "agent profile id 'auto' is reserved for automatic selection",
	});

export const AgentProfileFileSchema = z.object({
	id: AgentProfileIdSchema,
	description: z.string().min(1).optional(),
	agent_kind: z.string().min(1).optional(),
	model: z.string().min(1).optional(),
	tags: z.array(z.string().min(1)).default([]),
	instructions: z.string().default(""),
	instructions_mode: InstructionsModeSchema.default("replace"),
	source: AgentProfileSourceSchema,
	file_path: z.string().min(1).optional(),
	extra_fields: z.record(z.string(), z.unknown()).optional(),
});
export type AgentProfileFile = z.infer<typeof AgentProfileFileSchema>;

export const ResolvedAgentProfileSchema = z.object({
	id: AgentProfileIdSchema,
	description: z.string().min(1),
	agent_kind: z.string().min(1).optional(),
	model: z.string().min(1).optional(),
	tags: z.array(z.string().min(1)).default([]),
	instructions: z.string().min(1),
	instructions_mode: InstructionsModeSchema.default("replace"),
	source: AgentProfileSourceSchema,
	sources: z.array(AgentProfileSourceSchema).min(1),
	file_paths: z.array(z.string().min(1)).default([]),
});
export type ResolvedAgentProfile = z.infer<typeof ResolvedAgentProfileSchema>;
