import { z } from "zod";

export const TaskStatusSchema = z.enum([
	"queued",
	"running",
	"input_required",
	"completed",
	"failed",
	"cancelled",
	"timed_out",
	"blocked",
]);

export type TaskStatus = z.infer<typeof TaskStatusSchema>;
