import { TeamPositionSchema } from "@cuekit/core";
import { z } from "zod";

export const TeamEventTypeSchema = z.enum(["finding", "decision", "blocker", "review_result"]);
export type TeamEventType = z.infer<typeof TeamEventTypeSchema>;

export const TeamEventSchema = z.object({
	sequence: z.number().int().positive(),
	id: z.string().min(1),
	team_id: z.string().min(1),
	task_id: z.string().min(1).nullable(),
	position: TeamPositionSchema.nullable(),
	event_type: TeamEventTypeSchema,
	message: z.string().min(1),
	payload_json: z.string().nullable(),
	created_at: z.string().datetime({ offset: true }),
});

export type TeamEvent = z.infer<typeof TeamEventSchema>;
