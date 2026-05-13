import {
	isTerminalTaskStatus,
	TaskStatusSchema,
	TeamPositionSchema,
	TeamStatusSchema,
	TeamTaskCountsSchema,
} from "@cuekit/core";
import { getTaskTeamById, listTaskEvents, listTasksByTeam, listTeamEvents } from "@cuekit/store";
import { z } from "incur";
import type { CommandContext } from "../command-context.ts";
import {
	buildTeamAttentionItemsFromEvents,
	type TeamAttentionItem,
	TeamAttentionItemSchema,
} from "../team-attention.ts";
import { TeamBlackboardEventSchema, toTeamBlackboardEvent } from "../team-blackboard.ts";
import { buildTeamRunSummary, TeamRunSummarySchema } from "../team-run-summary.ts";
import { aggregateTeamStatus, countTeamTasks } from "../team-status.ts";

const DEFAULT_EVENT_LIMIT = 20;
const HANDOFF_PREVIEW_LENGTH = 200;
const CHILD_REPORT_TYPES = new Set([
	"progress",
	"completed",
	"failed",
	"blocked",
	"help_requested",
	"log",
]);
const RECENT_EVENT_TYPES = new Set([...CHILD_REPORT_TYPES, "handoff"]);

export const GetTeamSnapshotInputSchema = z.object({
	team_id: z.string().min(1),
	event_limit: z.number().int().positive().optional(),
});
export type GetTeamSnapshotInput = z.infer<typeof GetTeamSnapshotInputSchema>;

const TeamSnapshotMemberSchema = z.object({
	task_id: z.string(),
	position: TeamPositionSchema.optional(),
	role: z.string().optional(),
	agent_kind: z.string(),
	model: z.string().optional(),
	status: TaskStatusSchema,
	summary: z.string().optional(),
	updated_at: z.string().datetime({ offset: true }),
});

const TeamSnapshotPositionEntrySchema = z.object({
	task_id: z.string(),
	status: TaskStatusSchema,
	last_report: z.string().optional(),
	updated_at: z.string().datetime({ offset: true }),
});

const TeamSnapshotEventSchema = z.object({
	sequence: z.number().int().positive(),
	event_id: z.string(),
	task_id: z.string(),
	position: TeamPositionSchema.optional(),
	type: z.string(),
	message: z.string().optional(),
	created_at: z.string().datetime({ offset: true }),
});

const TeamSnapshotHandoffSchema = z.object({
	task_id: z.string(),
	position: TeamPositionSchema.optional(),
	event_id: z.string(),
	sequence: z.number().int().positive(),
	message_preview: z.string().optional(),
	artifact_path: z.string().optional(),
	created_at: z.string().datetime({ offset: true }),
});

const TeamSnapshotBlockerSchema = z.object({
	task_id: z.string(),
	position: TeamPositionSchema.optional(),
	message: z.string(),
});

const TeamSnapshotManualSteerHintSchema = z.object({
	attention_sequence: z.number().int().positive().optional(),
	task_id: z.string(),
	position: TeamPositionSchema.optional(),
	target: z.union([
		z.object({ kind: z.literal("task"), task_id: z.string() }),
		z.object({ kind: z.literal("team"), team_id: z.string() }),
		z.object({
			kind: z.literal("team_position"),
			team_id: z.string(),
			position: TeamPositionSchema,
		}),
		z.object({ kind: z.literal("team_tasks"), team_id: z.string(), task_ids: z.array(z.string()) }),
	]),
	tool: z.literal("steer"),
	suggested_message: z.string().optional(),
	rationale: z.string().optional(),
});

export const GetTeamSnapshotOutputSchema = z.union([
	z.object({
		team_id: z.string(),
		session_id: z.string(),
		title: z.string(),
		objective: z.string().optional(),
		status: TeamStatusSchema,
		task_counts: TeamTaskCountsSchema,
		generated_at: z.string().datetime({ offset: true }),
		members: z.array(TeamSnapshotMemberSchema),
		positions: z.record(TeamPositionSchema, z.array(TeamSnapshotPositionEntrySchema)),
		recent_events: z.array(TeamSnapshotEventSchema),
		blackboard_events: z.array(TeamBlackboardEventSchema),
		attention_items: z.array(TeamAttentionItemSchema).optional(),
		manual_steer_hints: z.array(TeamSnapshotManualSteerHintSchema).optional(),
		latest_handoffs: z.array(TeamSnapshotHandoffSchema),
		observability: TeamRunSummarySchema.shape.observability.optional(),
		blockers: z.array(TeamSnapshotBlockerSchema).optional(),
		guidance: z.object({
			recommended_next_reads: z.array(z.string()).optional(),
			manual_steer_hints: z.array(TeamSnapshotManualSteerHintSchema).optional(),
			suggested_next_actions: z.array(z.string()).optional(),
		}),
	}),
	z.object({
		error: z.object({
			code: z.literal("team_not_found"),
			message: z.string(),
			retryable: z.boolean().optional(),
		}),
	}),
]);
export type GetTeamSnapshotOutput = z.infer<typeof GetTeamSnapshotOutputSchema>;

type TeamTask = ReturnType<typeof listTasksByTeam>[number];
type TeamEvent = ReturnType<typeof listTaskEvents>[number];
type TeamSnapshotPositions = Record<
	z.infer<typeof TeamPositionSchema>,
	z.infer<typeof TeamSnapshotPositionEntrySchema>[]
>;

function taskPosition(task: TeamTask): z.infer<typeof TeamPositionSchema> | undefined {
	return task.team_position ?? undefined;
}

function artifactPath(payload: unknown): string | undefined {
	if (!payload || typeof payload !== "object") return undefined;
	const value = (payload as { artifact_path?: unknown }).artifact_path;
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function eventMessage(event: TeamEvent): string | undefined {
	return event.message ?? undefined;
}

function lastReport(events: TeamEvent[]): string | undefined {
	return (
		events.findLast((event) => event.message && CHILD_REPORT_TYPES.has(event.type))?.message ??
		undefined
	);
}

function latestAttentionResolutionType(events: TeamEvent[]): string | undefined {
	return events.findLast((event) => CHILD_REPORT_TYPES.has(event.type) && event.type !== "log")
		?.type;
}

function buildSnapshotManualSteerHints(
	items: TeamAttentionItem[],
	taskById: Map<string, TeamTask>,
	latestChildReportTypeByTaskId: Map<string, string | undefined>,
) {
	return items
		.filter((item) => {
			const task = taskById.get(item.task_id);
			if (!task) return false;
			if (item.type === "blocked") {
				return (
					task.status === "blocked" && latestChildReportTypeByTaskId.get(item.task_id) === "blocked"
				);
			}
			if (item.type === "help_requested") {
				return (
					(task.status === "running" || task.status === "input_required") &&
					latestChildReportTypeByTaskId.get(item.task_id) === "help_requested"
				);
			}
			return false;
		})
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

function makeSuggestedNextActions(args: {
	blockers: Array<{ task_id: string }>;
	manualSteerHints: Array<{ attention_sequence?: number }>;
	allMembersTerminal: boolean;
}): string[] {
	const actions: string[] = [];
	for (const blocker of args.blockers) {
		actions.push(`Inspect blocked task ${blocker.task_id} before waiting again.`);
	}
	if (args.manualSteerHints.length > 0) {
		actions.push(
			`Review attention item ${args.manualSteerHints.at(-1)?.attention_sequence} before deciding next action.`,
		);
	}
	if (args.allMembersTerminal && args.blockers.length === 0) {
		actions.push("All team tasks are terminal; inspect get_team_result before final reporting.");
	}
	if (actions.length === 0) {
		actions.push(
			"No immediate blockers detected; use a bounded wait or inspect member task snapshots if needed.",
		);
	}
	return actions;
}

export function runGetTeamSnapshot(
	ctx: CommandContext,
	input: GetTeamSnapshotInput,
): GetTeamSnapshotOutput {
	const team = getTaskTeamById(ctx.db, input.team_id);
	if (!team) {
		return {
			error: {
				code: "team_not_found",
				message: `team '${input.team_id}' not found`,
				retryable: false,
			},
		};
	}

	const tasks = listTasksByTeam(ctx.db, team.id);
	const taskEvents = tasks.map((task) => ({ task, events: listTaskEvents(ctx.db, task.id) }));
	const blackboardEvents = listTeamEvents(ctx.db, team.id)
		.map(toTeamBlackboardEvent)
		.slice(-(input.event_limit ?? DEFAULT_EVENT_LIMIT));
	const summary = buildTeamRunSummary(ctx, tasks);
	const attentionItems = buildTeamAttentionItemsFromEvents(taskEvents, {
		includeFullMessage: false,
	});
	const taskById = new Map(tasks.map((task) => [task.id, task]));
	const latestAttentionResolutionTypeByTaskId = new Map(
		taskEvents.map(({ task, events }) => [task.id, latestAttentionResolutionType(events)]),
	);
	const manualSteerHints = buildSnapshotManualSteerHints(
		attentionItems,
		taskById,
		latestAttentionResolutionTypeByTaskId,
	);
	const eventLimit = input.event_limit ?? DEFAULT_EVENT_LIMIT;

	const members = tasks.map((task) => ({
		task_id: task.id,
		...(taskPosition(task) ? { position: taskPosition(task) } : {}),
		...(task.role ? { role: task.role } : {}),
		agent_kind: task.agent_kind,
		...(task.model ? { model: task.model } : {}),
		status: task.status,
		...(task.summary ? { summary: task.summary } : {}),
		updated_at: task.updated_at,
	}));

	const positions: TeamSnapshotPositions = {
		coordinator: [],
		worker: [],
		reviewer: [],
		finisher: [],
		observer: [],
	};
	for (const { task, events } of taskEvents) {
		const position = taskPosition(task);
		if (!position) continue;
		positions[position].push({
			task_id: task.id,
			status: task.status,
			...(lastReport(events) ? { last_report: lastReport(events) } : {}),
			updated_at: task.updated_at,
		});
	}

	const recentEvents = taskEvents
		.flatMap(({ task, events }) =>
			events
				.filter((event) => RECENT_EVENT_TYPES.has(event.type))
				.map((event) => ({
					sequence: event.sequence,
					event_id: event.id,
					task_id: task.id,
					...(taskPosition(task) ? { position: taskPosition(task) } : {}),
					type: event.type,
					...(eventMessage(event) ? { message: eventMessage(event) } : {}),
					created_at: event.created_at,
				})),
		)
		.toSorted((a, b) => a.sequence - b.sequence)
		.slice(-eventLimit);

	const latestHandoffs = taskEvents
		.flatMap(({ task, events }) =>
			events
				.filter((event) => event.type === "handoff")
				.map((event) => ({
					task_id: task.id,
					...(taskPosition(task) ? { position: taskPosition(task) } : {}),
					event_id: event.id,
					sequence: event.sequence,
					...(event.message
						? { message_preview: event.message.slice(0, HANDOFF_PREVIEW_LENGTH) }
						: {}),
					...(artifactPath(event.payload) ? { artifact_path: artifactPath(event.payload) } : {}),
					created_at: event.created_at,
				})),
		)
		.toSorted((a, b) => a.sequence - b.sequence)
		.slice(-eventLimit);

	const blockers = taskEvents
		.flatMap(({ task, events }) => {
			if (task.status !== "blocked") return [];
			if (latestAttentionResolutionTypeByTaskId.get(task.id) !== "blocked") return [];
			const latestBlocked = events.findLast((event) => event.type === "blocked" && event.message);
			return [
				{
					task_id: task.id,
					...(taskPosition(task) ? { position: taskPosition(task) } : {}),
					message: latestBlocked?.message ?? task.summary ?? "Task is blocked.",
				},
			];
		})
		.toSorted((a, b) => a.task_id.localeCompare(b.task_id));

	const allMembersTerminal =
		tasks.length > 0 && tasks.every((task) => isTerminalTaskStatus(task.status));
	const suggestedNextActions = makeSuggestedNextActions({
		blockers,
		manualSteerHints,
		allMembersTerminal,
	});

	return {
		team_id: team.id,
		session_id: team.session_id,
		title: team.title,
		...(team.objective ? { objective: team.objective } : {}),
		status: aggregateTeamStatus(tasks),
		task_counts: countTeamTasks(tasks),
		generated_at: new Date().toISOString(),
		members,
		positions,
		recent_events: recentEvents,
		blackboard_events: blackboardEvents,
		...(attentionItems.length > 0 ? { attention_items: attentionItems } : {}),
		...(manualSteerHints.length > 0 ? { manual_steer_hints: manualSteerHints } : {}),
		latest_handoffs: latestHandoffs,
		...(summary.observability ? { observability: summary.observability } : {}),
		...(blockers.length > 0 ? { blockers } : {}),
		guidance: {
			recommended_next_reads: [
				"Inspect attention_items and blockers before steering or waiting again.",
				"Open latest_handoffs artifacts when present.",
				"Use get_task_snapshot for a specific member before task-level steering.",
				"Read blackboard_events for shared findings, decisions, blockers, and review results.",
			],
			...(manualSteerHints.length > 0 ? { manual_steer_hints: manualSteerHints } : {}),
			suggested_next_actions: suggestedNextActions,
		},
	};
}
