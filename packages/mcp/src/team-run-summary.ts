import {
	intersectObservedFiles,
	parseTaskObservabilityPayload,
	TaskStatusSchema,
	TeamPositionSchema,
} from "@cuekit/core";
import { listTaskEvents, type Task } from "@cuekit/store";
import { z } from "incur";
import type { CommandContext } from "./command-context.ts";

const POSITIONS = ["coordinator", "worker", "reviewer", "finisher", "observer"] as const;
const REPORT_TYPES = new Set(["progress", "completed", "failed", "blocked", "help_requested"]);
const TERMINAL_REPORT_TYPES = new Set(["completed", "failed", "blocked"]);
const MAX_MESSAGE_LENGTH = 240;
const MAX_ENTRIES_PER_POSITION = 5;

export const TeamRunSummaryEntrySchema = z.object({
	task_id: z.string(),
	type: z.string(),
	status: TaskStatusSchema,
	message: z.string(),
	created_at: z.string().datetime({ offset: true }),
});

export const TeamRunSummarySchema = z.object({
	terminal_reports: z.number().int().nonnegative(),
	latest_terminal_message: z.string().optional(),
	positions: z.record(TeamPositionSchema, z.array(TeamRunSummaryEntrySchema)),
	open_attention: z
		.array(
			z.object({
				task_id: z.string(),
				position: TeamPositionSchema.optional(),
				status: TaskStatusSchema,
				message: z.string().optional(),
			}),
		)
		.optional(),
	observability: z
		.object({
			files_read: z.array(z.string()),
			files_written: z.array(z.string()),
			diagnostics: z.array(
				z.object({
					task_id: z.string(),
					kind: z.string(),
					message: z.string().optional(),
				}),
			),
			warnings: z
				.array(
					z.object({
						kind: z.literal("stale_read"),
						message: z.string(),
						paths: z.array(z.string()),
					}),
				)
				.optional(),
		})
		.optional(),
});

export type TeamRunSummary = z.infer<typeof TeamRunSummarySchema>;

function truncateMessage(message: string): string {
	return message.length <= MAX_MESSAGE_LENGTH
		? message
		: `${message.slice(0, MAX_MESSAGE_LENGTH - 1)}…`;
}

function emptyPositions(): TeamRunSummary["positions"] {
	return {
		coordinator: [],
		worker: [],
		reviewer: [],
		finisher: [],
		observer: [],
	};
}

function taskPosition(task: Task): (typeof POSITIONS)[number] | undefined {
	return POSITIONS.find((position) => position === task.team_position);
}

function appendUnique(target: string[], values: string[] | undefined): void {
	if (!values) return;
	const seen = new Set(target);
	for (const value of values) {
		if (seen.has(value)) continue;
		seen.add(value);
		target.push(value);
	}
}

export function emptyTeamRunSummary(): TeamRunSummary {
	return {
		terminal_reports: 0,
		positions: emptyPositions(),
	};
}

export function buildTeamRunSummary(ctx: CommandContext, tasks: Task[]): TeamRunSummary {
	const positions = emptyPositions();
	let terminalReports = 0;
	let latestTerminal: { sequence: number; message: string } | undefined;
	const openAttention: NonNullable<TeamRunSummary["open_attention"]> = [];
	const filesRead: string[] = [];
	const filesWritten: string[] = [];
	const diagnostics: NonNullable<TeamRunSummary["observability"]>["diagnostics"] = [];

	for (const task of tasks) {
		const position = taskPosition(task);
		let latestMessage: string | undefined;
		for (const event of listTaskEvents(ctx.db, task.id)) {
			const observability = parseTaskObservabilityPayload(event.payload);
			appendUnique(filesRead, observability?.files?.read);
			appendUnique(filesWritten, observability?.files?.written);
			if (observability?.diagnostic) {
				diagnostics.push({
					task_id: task.id,
					kind: observability.diagnostic.kind,
					...(observability.diagnostic.message
						? { message: observability.diagnostic.message }
						: {}),
				});
			}

			if (!event.message || !REPORT_TYPES.has(event.type)) continue;
			latestMessage = event.message;
			const entry = {
				task_id: task.id,
				type: event.type,
				status: task.status,
				message: truncateMessage(event.message),
				created_at: event.created_at,
			};
			if (position) positions[position].push(entry);
			if (TERMINAL_REPORT_TYPES.has(event.type)) {
				terminalReports += 1;
				if (!latestTerminal || event.sequence > latestTerminal.sequence) {
					latestTerminal = { sequence: event.sequence, message: event.message };
				}
			}
		}
		if (
			task.status === "running" ||
			task.status === "input_required" ||
			task.status === "blocked"
		) {
			openAttention.push({
				task_id: task.id,
				...(position ? { position } : {}),
				status: task.status,
				...(latestMessage ? { message: truncateMessage(latestMessage) } : {}),
			});
		}
	}

	for (const position of POSITIONS) {
		positions[position] = positions[position]
			.toSorted((a, b) => a.created_at.localeCompare(b.created_at))
			.slice(-MAX_ENTRIES_PER_POSITION);
	}

	const staleReadPaths = intersectObservedFiles(filesRead, filesWritten);
	const observability =
		filesRead.length > 0 || filesWritten.length > 0 || diagnostics.length > 0
			? {
					files_read: filesRead,
					files_written: filesWritten,
					diagnostics,
					...(staleReadPaths.length > 0
						? {
								warnings: [
									{
										kind: "stale_read" as const,
										message:
											"Some tasks read files that were also written by team tasks; re-read may be needed.",
										paths: staleReadPaths,
									},
								],
							}
						: {}),
				}
			: undefined;

	return {
		terminal_reports: terminalReports,
		...(latestTerminal ? { latest_terminal_message: truncateMessage(latestTerminal.message) } : {}),
		positions,
		...(openAttention.length > 0 ? { open_attention: openAttention } : {}),
		...(observability ? { observability } : {}),
	};
}
