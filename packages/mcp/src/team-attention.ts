import type { Database } from "bun:sqlite";
import { TeamPositionSchema } from "@cuekit/core";
import { listTaskEvents, type Task } from "@cuekit/store";
import { z } from "incur";

const ATTENTION_EVENT_TYPES = ["completed", "failed", "blocked", "help_requested"] as const;
const ATTENTION_TYPES = new Set<string>(ATTENTION_EVENT_TYPES);
const DEFAULT_ATTENTION_LIMIT = 10;

export const TeamAttentionItemSchema = z.object({
	sequence: z.number().int().positive(),
	task_id: z.string(),
	position: TeamPositionSchema.optional(),
	type: z.enum(ATTENTION_EVENT_TYPES),
	reason: z.enum(["terminal_report", "help_requested"]),
	message: z.string().optional(),
	created_at: z.string().datetime({ offset: true }),
});

export type TeamAttentionItem = z.infer<typeof TeamAttentionItemSchema>;

function reasonForEventType(type: TeamAttentionItem["type"]): TeamAttentionItem["reason"] {
	return type === "help_requested" ? "help_requested" : "terminal_report";
}

export function buildTeamAttentionItems(
	db: Database,
	tasks: Task[],
	options: { limit?: number } = {},
): TeamAttentionItem[] {
	const limit = options.limit ?? DEFAULT_ATTENTION_LIMIT;
	if (limit <= 0) return [];

	const items = tasks.flatMap((task) => {
		if (task.team_position === "coordinator") return [];
		return listTaskEvents(db, task.id)
			.filter((event) => ATTENTION_TYPES.has(event.type))
			.map((event) => {
				const type = event.type as TeamAttentionItem["type"];
				return {
					sequence: event.sequence,
					task_id: task.id,
					...(task.team_position ? { position: task.team_position } : {}),
					type,
					reason: reasonForEventType(type),
					...(event.message ? { message: event.message } : {}),
					created_at: event.created_at,
				};
			});
	});

	return items.toSorted((a, b) => a.sequence - b.sequence).slice(-limit);
}
