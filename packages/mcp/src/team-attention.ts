import type { Database } from "bun:sqlite";
import { TeamPositionSchema } from "@cuekit/core";
import { listTaskEvents, type Task, type TaskEvent } from "@cuekit/store";
import { z } from "incur";

const ATTENTION_EVENT_TYPES = ["completed", "failed", "blocked", "help_requested"] as const;
const ATTENTION_TYPES = new Set<string>(ATTENTION_EVENT_TYPES);
const DEFAULT_ATTENTION_LIMIT = 10;
export const TEAM_ATTENTION_MESSAGE_PREVIEW_LENGTH = 240;

export const TeamAttentionSteerTargetSchema = z.object({
	task_id: z.string(),
	event_sequence: z.number().int().positive(),
});

export const ManualSteerHintSchema = z.object({
	attention_sequence: z.number().int().positive(),
	task_id: z.string(),
	position: TeamPositionSchema.optional(),
	target: z.object({
		kind: z.literal("task"),
		task_id: z.string(),
	}),
	tool: z.literal("steer"),
	suggested_message: z.string(),
	rationale: z.string(),
});

export const TeamAttentionItemSchema = z.object({
	sequence: z.number().int().positive(),
	task_id: z.string(),
	position: TeamPositionSchema.optional(),
	type: z.enum(ATTENTION_EVENT_TYPES),
	reason: z.enum(["terminal_report", "help_requested"]),
	message: z.string().optional(),
	message_preview: z.string().optional(),
	full_message: z.string().optional(),
	steer_target: TeamAttentionSteerTargetSchema,
	created_at: z.string().datetime({ offset: true }),
});

export type TeamAttentionItem = z.infer<typeof TeamAttentionItemSchema>;
export type ManualSteerHint = z.infer<typeof ManualSteerHintSchema>;

export type TeamAttentionTaskEvents = {
	task: Task;
	events: TaskEvent[];
};

function messagePreview(message: string): string {
	return message.length <= TEAM_ATTENTION_MESSAGE_PREVIEW_LENGTH
		? message
		: `${message.slice(0, TEAM_ATTENTION_MESSAGE_PREVIEW_LENGTH - 1)}…`;
}

function reasonForEventType(type: TeamAttentionItem["type"]): TeamAttentionItem["reason"] {
	return type === "help_requested" ? "help_requested" : "terminal_report";
}

export function buildTeamAttentionItemsFromEvents(
	taskEvents: TeamAttentionTaskEvents[],
	options: { limit?: number; includeFullMessage?: boolean } = {},
): TeamAttentionItem[] {
	const limit = options.limit ?? DEFAULT_ATTENTION_LIMIT;
	if (limit <= 0) return [];
	const includeFullMessage = options.includeFullMessage ?? true;

	const items = taskEvents.flatMap(({ task, events }) => {
		if (task.team_position === "coordinator") return [];
		return events
			.filter((event) => ATTENTION_TYPES.has(event.type))
			.map((event) => {
				const type = event.type as TeamAttentionItem["type"];
				return {
					sequence: event.sequence,
					task_id: task.id,
					...(task.team_position ? { position: task.team_position } : {}),
					type,
					reason: reasonForEventType(type),
					...(event.message
						? {
								message: includeFullMessage ? event.message : messagePreview(event.message),
								message_preview: messagePreview(event.message),
								...(includeFullMessage ? { full_message: event.message } : {}),
							}
						: {}),
					steer_target: { task_id: task.id, event_sequence: event.sequence },
					created_at: event.created_at,
				};
			});
	});

	return items.toSorted((a, b) => a.sequence - b.sequence).slice(-limit);
}

export function buildManualSteerHintsFromAttentionItems(
	items: TeamAttentionItem[],
): ManualSteerHint[] {
	return items
		.filter((item) => item.type === "help_requested" || item.type === "blocked")
		.map((item) => {
			const quoted = item.message_preview ? ` Latest report: "${item.message_preview}"` : "";
			return {
				attention_sequence: item.sequence,
				task_id: item.task_id,
				...(item.position ? { position: item.position } : {}),
				target: { kind: "task" as const, task_id: item.task_id },
				tool: "steer" as const,
				suggested_message: `Please respond to this ${item.type} attention item.${quoted} If you need parent input, report help_requested with one precise question; otherwise continue and report progress or a terminal result.`,
				rationale:
					"Manual helper only: inspect the attention item and decide whether to send this with grouped steer; cuekit will not auto-steer or track delivery/read state.",
			};
		});
}

export function buildTeamAttentionItems(
	db: Database,
	tasks: Task[],
	options: { limit?: number; includeFullMessage?: boolean } = {},
): TeamAttentionItem[] {
	return buildTeamAttentionItemsFromEvents(
		tasks.map((task) => ({ task, events: listTaskEvents(db, task.id) })),
		options,
	);
}
