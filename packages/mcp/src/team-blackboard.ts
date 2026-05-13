import { TeamPositionSchema } from "@cuekit/core";
import { type TeamEvent, TeamEventTypeSchema } from "@cuekit/store";
import { z } from "incur";

export const TeamBlackboardEventSchema = z.object({
	sequence: z.number().int().positive(),
	event_id: z.string(),
	task_id: z.string().optional(),
	position: TeamPositionSchema.optional(),
	event_type: TeamEventTypeSchema,
	message: z.string(),
	payload: z.unknown().optional(),
	created_at: z.string().datetime({ offset: true }),
});
export type TeamBlackboardEvent = z.infer<typeof TeamBlackboardEventSchema>;

function decodePayload(payloadJson: string | null): unknown | undefined {
	if (!payloadJson) return undefined;
	try {
		return JSON.parse(payloadJson) as unknown;
	} catch {
		return payloadJson;
	}
}

export function toTeamBlackboardEvent(event: TeamEvent): TeamBlackboardEvent {
	const payload = decodePayload(event.payload_json);
	return {
		sequence: event.sequence,
		event_id: event.id,
		...(event.task_id ? { task_id: event.task_id } : {}),
		...(event.position ? { position: event.position } : {}),
		event_type: event.event_type,
		message: event.message,
		...(payload !== undefined ? { payload } : {}),
		created_at: event.created_at,
	};
}
