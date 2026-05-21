import type { Database } from "bun:sqlite";
import { TeamPositionSchema } from "@cuekit/core";
import {
	type TeamEvent,
	TeamEventSchema,
	type TeamEventType,
	TeamEventTypeSchema,
} from "./team-event.ts";

export type { TeamEvent, TeamEventType } from "./team-event.ts";
export { KNOWN_TEAM_EVENT_TYPES, TeamEventSchema, TeamEventTypeSchema } from "./team-event.ts";

export interface AppendTeamEventInput {
	id: string;
	team_id: string;
	task_id?: string;
	position?: string;
	event_type: TeamEventType;
	message: string;
	payload?: unknown;
}

function encodePayload(payload: unknown): string | null {
	return payload === undefined ? null : JSON.stringify(payload);
}

function assertTaskBelongsToTeam(db: Database, task_id: string | undefined, team_id: string): void {
	if (!task_id) return;
	const row = db.prepare("select team_id from tasks where id = ?").get(task_id) as
		| { team_id: string | null }
		| undefined;
	if (!row || row.team_id !== team_id) {
		throw new Error(`task_id must belong to the same team: ${task_id}`);
	}
}

export function appendTeamEvent(db: Database, input: AppendTeamEventInput): TeamEvent {
	const eventType = TeamEventTypeSchema.parse(input.event_type);
	const position = input.position === undefined ? null : TeamPositionSchema.parse(input.position);
	assertTaskBelongsToTeam(db, input.task_id, input.team_id);
	const now = new Date().toISOString();
	db.prepare(
		`insert into team_events (
			id, team_id, task_id, position, event_type, message, payload_json, created_at
		) values (?, ?, ?, ?, ?, ?, ?, ?)`,
	).run(
		input.id,
		input.team_id,
		input.task_id ?? null,
		position,
		eventType,
		input.message,
		encodePayload(input.payload),
		now,
	);
	const row = db.prepare("select * from team_events where id = ?").get(input.id);
	return TeamEventSchema.parse(row);
}

export function listTeamEvents(db: Database, team_id: string): TeamEvent[] {
	const rows = db
		.prepare("select * from team_events where team_id = ? order by sequence asc")
		.all(team_id);
	return rows.map((row) => TeamEventSchema.parse(row));
}
