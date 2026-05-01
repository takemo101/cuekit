import { z } from "zod";

export const JobErrorCodeSchema = z.enum([
	"adapter_not_found",
	"submit_failed",
	"status_unavailable",
	"steering_unsupported",
	"collect_unavailable",
	"task_not_found",
	"team_not_found",
	"session_not_found",
	"invalid_state",
	"invalid_input",
	"runtime_crash",
	"timeout",
	"malformed_result",
	"permission_denied",
	"transport_error",
	"unknown",
]);

export type JobErrorCode = z.infer<typeof JobErrorCodeSchema>;

export const JobErrorSchema = z.object({
	code: JobErrorCodeSchema,
	message: z.string(),
	retryable: z.boolean().optional(),
	details: z.record(z.string(), z.unknown()).optional(),
});

export type JobError = z.infer<typeof JobErrorSchema>;
