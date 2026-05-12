import { z } from "zod";

export const ProjectIdSchema = z.string().regex(/^[A-Za-z0-9._-]+$/);
export const TuiScopeSchema = z.enum(["project", "path"]);
export const TeamCleanupSchema = z.enum(["keep-team", "delete-empty-team"]);
export const AdapterPermissionSchema = z.enum(["prompt", "bypass"]);
export const MultiplexerSchema = z.enum(["tmux", "zellij", "herdr"]);
export const MultiplexerConfigSchema = z.union([
	MultiplexerSchema,
	z
		.object({
			backend: MultiplexerSchema,
			strict: z.boolean().optional(),
		})
		.strict(),
]);
export const StrategyPositionSchema = z.enum([
	"coordinator",
	"worker",
	"reviewer",
	"finisher",
	"observer",
]);

export const TeamStrategySlotSchema = z
	.object({
		position: StrategyPositionSchema.optional(),
		role: z.string().min(1).optional(),
		agent: z.string().min(1).optional(),
		model: z.string().min(1).optional(),
		objective: z.string().min(1).optional(),
		adapter_options: z.record(z.string(), z.unknown()).optional(),
	})
	.strict();

export const TeamStrategySchema = z
	.object({
		description: z.string().min(1).optional(),
		intent: z.string().min(1).optional(),
		recommended_team: z.record(z.string().min(1), TeamStrategySlotSchema).optional(),
		guardrails: z.array(z.string().min(1)).optional(),
		success_criteria: z.array(z.string().min(1)).optional(),
		checks: z.array(z.string().min(1)).optional(),
		autonomy: z
			.object({
				allow_additional_workers: z.boolean().optional(),
				allow_parallel_reviewers: z.boolean().optional(),
				require_reviewer: z.boolean().optional(),
				allow_skip_checks: z.boolean().optional(),
			})
			.strict()
			.optional(),
	})
	.strict();

export const HookDefinitionSchema = z
	.object({
		command: z.string().min(1),
		timeout: z.number().int().positive().optional(),
	})
	.strict();

export const HooksConfigSchema = z
	.object({
		on_task_complete: HookDefinitionSchema.optional(),
		on_task_fail: HookDefinitionSchema.optional(),
		on_task_cancel: HookDefinitionSchema.optional(),
		on_task_timeout: HookDefinitionSchema.optional(),
		on_team_start: HookDefinitionSchema.optional(),
		on_team_complete: HookDefinitionSchema.optional(),
	})
	.strict()
	.optional();

export const CuekitProjectConfigSchema = z
	.object({
		project: z
			.object({
				id: ProjectIdSchema.optional(),
				name: z.string().min(1).optional(),
			})
			.strict()
			.optional(),
		tui: z
			.object({
				scope: TuiScopeSchema.optional(),
			})
			.strict()
			.optional(),
		submit: z
			.object({
				role: z.string().min(1).optional(),
				agent: z.string().min(1).optional(),
				model: z.string().min(1).optional(),
				timeout_ms: z.number().int().positive().optional(),
				priority: z.enum(["low", "normal", "high"]).optional(),
			})
			.strict()
			.optional(),
		teams: z
			.object({
				roles: z
					.object({
						coordinator: z.string().min(1).optional(),
						worker: z.string().min(1).optional(),
						reviewer: z.string().min(1).optional(),
						finisher: z.string().min(1).optional(),
						observer: z.string().min(1).optional(),
					})
					.strict()
					.optional(),
				cleanup: TeamCleanupSchema.optional(),
				wait: z
					.object({
						timeout_ms: z.number().int().min(0).optional(),
						poll_interval_ms: z.number().int().positive().optional(),
					})
					.strict()
					.optional(),
			})
			.strict()
			.optional(),
		adapters: z
			.record(
				z.string().min(1),
				z
					.object({
						permissions: AdapterPermissionSchema.optional(),
					})
					.strict(),
			)
			.optional(),
		strategies: z.record(z.string().min(1), TeamStrategySchema).optional(),
		multiplexer: MultiplexerConfigSchema.optional(),
		// Legacy alias for `multiplexer.strict`. When true and the requested
		// backend probe fails, cuekit hard-fails at startup instead of
		// silently falling back to tmux.
		multiplexer_strict: z.boolean().optional(),
		hooks: HooksConfigSchema.optional(),
	})
	.strict();

export type CuekitProjectConfig = z.infer<typeof CuekitProjectConfigSchema>;
export type TuiScope = z.infer<typeof TuiScopeSchema>;
export type TeamCleanup = z.infer<typeof TeamCleanupSchema>;
export type AdapterPermission = z.infer<typeof AdapterPermissionSchema>;
export type Multiplexer = z.infer<typeof MultiplexerSchema>;
export type MultiplexerConfig = z.infer<typeof MultiplexerConfigSchema>;
export type TeamStrategy = z.infer<typeof TeamStrategySchema>;
export type TeamStrategySlot = z.infer<typeof TeamStrategySlotSchema>;
export type SubmitDefaults = NonNullable<CuekitProjectConfig["submit"]>;
export type TeamDefaults = NonNullable<CuekitProjectConfig["teams"]>;
export type AdapterPermissionDefaults = NonNullable<CuekitProjectConfig["adapters"]>;
export type HookDefinition = z.infer<typeof HookDefinitionSchema>;
export type HooksConfig = z.infer<typeof HooksConfigSchema>;
