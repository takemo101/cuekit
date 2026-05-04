import { z } from "zod";

const AdapterRunModeSchema = z.enum(["interactive", "batch"]);

export const AdapterCapabilitiesSchema = z
	.object({
		agent_kind: z.string().min(1),
		supports_steering: z.boolean(),
		supports_attach: z.boolean(),
		supports_model_selection: z.boolean(),
		available_models: z.array(z.string().min(1)).min(1).optional(),
		supports_artifacts: z.boolean().optional(),
		supports_live_progress: z.boolean().optional(),
		default_mode: AdapterRunModeSchema.optional(),
		supported_modes: z.array(AdapterRunModeSchema).min(1).optional(),
	})
	.refine((caps) => !caps.available_models || caps.supports_model_selection, {
		message: "available_models requires supports_model_selection: true",
		path: ["available_models"],
	});

export type AdapterCapabilities = z.infer<typeof AdapterCapabilitiesSchema>;
