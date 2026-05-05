import { z } from "zod";

export const TeamPositionSchema = z.enum([
	"coordinator",
	"worker",
	"reviewer",
	"finisher",
	"observer",
]);
export type TeamPosition = z.infer<typeof TeamPositionSchema>;

export const TeamStatusSchema = z.enum([
	"empty",
	"running",
	"completed",
	"failed",
	"cancelled",
	"timed_out",
	"blocked",
	"mixed",
]);
export type TeamStatus = z.infer<typeof TeamStatusSchema>;

export const TeamTaskCountsSchema = z.object({
	total: z.number().int().nonnegative(),
	queued: z.number().int().nonnegative(),
	running: z.number().int().nonnegative(),
	input_required: z.number().int().nonnegative(),
	completed: z.number().int().nonnegative(),
	failed: z.number().int().nonnegative(),
	cancelled: z.number().int().nonnegative(),
	timed_out: z.number().int().nonnegative(),
	blocked: z.number().int().nonnegative(),
});
export type TeamTaskCounts = z.infer<typeof TeamTaskCountsSchema>;

export const TaskTeamSchema = z.object({
	team_id: z.string().min(1),
	session_id: z.string().min(1),
	title: z.string().min(1),
	objective: z.string().min(1).optional(),
	created_at: z.string().datetime({ offset: true }),
	updated_at: z.string().datetime({ offset: true }),
	metadata: z.record(z.string(), z.unknown()).optional(),
});
export type TaskTeam = z.infer<typeof TaskTeamSchema>;

export const TeamSummarySchema = TaskTeamSchema.extend({
	status: TeamStatusSchema,
	task_counts: TeamTaskCountsSchema,
});
export type TeamSummary = z.infer<typeof TeamSummarySchema>;
