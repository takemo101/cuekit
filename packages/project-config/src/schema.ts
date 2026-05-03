import { z } from "zod";

export const ProjectIdSchema = z.string().regex(/^[A-Za-z0-9._-]+$/);
export const TuiScopeSchema = z.enum(["project", "path"]);
export const TeamCleanupSchema = z.enum(["keep-team", "delete-empty-team"]);
export const AdapterPermissionSchema = z.enum(["prompt", "bypass"]);

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
	})
	.strict();

export type CuekitProjectConfig = z.infer<typeof CuekitProjectConfigSchema>;
export type TuiScope = z.infer<typeof TuiScopeSchema>;
export type TeamCleanup = z.infer<typeof TeamCleanupSchema>;
export type AdapterPermission = z.infer<typeof AdapterPermissionSchema>;
export type SubmitDefaults = NonNullable<CuekitProjectConfig["submit"]>;
export type TeamDefaults = NonNullable<CuekitProjectConfig["teams"]>;
export type AdapterPermissionDefaults = NonNullable<CuekitProjectConfig["adapters"]>;
