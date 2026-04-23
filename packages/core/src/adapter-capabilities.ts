import { z } from "zod";

export const AdapterCapabilitiesSchema = z.object({
	agent_kind: z.string().min(1),
	supports_steering: z.boolean(),
	supports_attach: z.boolean(),
	supports_model_selection: z.boolean(),
	available_models: z.array(z.string()).optional(),
	supports_artifacts: z.boolean().optional(),
	supports_live_progress: z.boolean().optional(),
});

export type AdapterCapabilities = z.infer<typeof AdapterCapabilitiesSchema>;
