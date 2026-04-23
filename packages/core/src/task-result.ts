import { z } from "zod";
import { ArtifactRefSchema } from "./artifact-ref.ts";
import { JobErrorSchema } from "./job-error.ts";

export const TerminalTaskResultStatusSchema = z.enum([
	"completed",
	"failed",
	"cancelled",
	"timed_out",
	"blocked",
]);

export type TerminalTaskResultStatus = z.infer<typeof TerminalTaskResultStatusSchema>;

export const TaskResultSchema = z.object({
	task_id: z.string().min(1),
	status: TerminalTaskResultStatusSchema,
	summary: z.string(),
	files_changed: z.array(z.string()),
	artifacts: z.array(ArtifactRefSchema),
	error: JobErrorSchema.optional(),
	metadata: z.record(z.unknown()).optional(),
});

export type TaskResult = z.infer<typeof TaskResultSchema>;
