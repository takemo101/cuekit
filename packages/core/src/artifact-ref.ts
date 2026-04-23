import { z } from "zod";

export const ArtifactRefSchema = z.object({
	kind: z.enum(["file", "directory", "report", "patch", "transcript", "json", "url", "log"]),
	ref: z.string().min(1),
	title: z.string().optional(),
	description: z.string().optional(),
	media_type: z.string().optional(),
	metadata: z.record(z.unknown()).optional(),
});

export type ArtifactRef = z.infer<typeof ArtifactRefSchema>;
