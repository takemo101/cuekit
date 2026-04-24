import { z } from "zod";
import { ArtifactRefSchema } from "./artifact-ref.ts";
import { JobErrorSchema } from "./job-error.ts";
import type { TaskStatus } from "./task-status.ts";

// The `satisfies readonly TaskStatus[]` constraint fails the build if a new
// terminal status is added here that is not also a member of TaskStatus, so
// the two enums cannot drift.
const TERMINAL_STATUS_VALUES = [
	"completed",
	"failed",
	"cancelled",
	"timed_out",
	"blocked",
] as const satisfies readonly TaskStatus[];

export const TerminalTaskResultStatusSchema = z.enum(TERMINAL_STATUS_VALUES);

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
