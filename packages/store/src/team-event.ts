import { TeamPositionSchema } from "@cuekit/core";
import { z } from "zod";

// Curated recommended set. Callers may use any non-empty string for
// event_type; this constant is the vocabulary the TUI and grouping
// utilities know about. Adding to it is non-breaking.
export const KNOWN_TEAM_EVENT_TYPES = [
	"finding",
	"decision",
	"blocker",
	"review_result",
	"note",
	"checkpoint",
	"progress",
	"handoff",
] as const;

export const TeamEventTypeSchema = z
	.string()
	.min(1)
	.describe(
		"Team blackboard event type. Recommended values include 'finding', 'decision', 'blocker', 'review_result', 'note', 'checkpoint', 'progress', 'handoff', but any non-empty string is accepted.",
	);
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
