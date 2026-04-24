import { z } from "zod";

export const ExpectedOutputSpecSchema = z.object({
	format: z.enum(["summary", "json", "markdown", "patch", "mixed"]).optional(),
	require_files_changed: z.boolean().optional(),
	require_artifacts: z.boolean().optional(),
	require_tests: z.boolean().optional(),
	schema_hint: z.record(z.unknown()).optional(),
});

export type ExpectedOutputSpec = z.infer<typeof ExpectedOutputSpecSchema>;
