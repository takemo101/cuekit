import { z } from "zod";

export const InputRefSchema = z.object({
	kind: z.enum(["file", "directory", "url", "text", "artifact", "spec", "transcript"]),
	ref: z.string().min(1),
	title: z.string().optional(),
	description: z.string().optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
});

export type InputRef = z.infer<typeof InputRefSchema>;
