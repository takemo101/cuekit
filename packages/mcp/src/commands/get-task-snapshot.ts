import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import { TaskSnapshotSchema, TaskSpecSchema } from "@cuekit/core";
import { getTaskById, listTaskEvents } from "@cuekit/store";
import { z } from "incur";
import type { CommandContext } from "../command-context.ts";
import { getTaskActivity } from "../task-activity.ts";
import { taskRunMetadata } from "../task-run-metadata.ts";

const DEFAULT_EVENT_LIMIT = 10;
const DEFAULT_TRANSCRIPT_LINES = 80;
const MAX_TRANSCRIPT_BYTES = 64 * 1024;

export const GetTaskSnapshotInputSchema = z.object({
	task_id: z.string().min(1).describe("cuekit task id."),
	event_limit: z.number().int().positive().optional(),
	transcript_lines: z.number().int().positive().optional(),
});
export type GetTaskSnapshotInput = z.infer<typeof GetTaskSnapshotInputSchema>;

export const GetTaskSnapshotOutputSchema = z.union([
	TaskSnapshotSchema,
	z.object({
		error: z.object({
			code: z.literal("task_not_found"),
			message: z.string(),
			retryable: z.boolean().optional(),
		}),
	}),
]);
export type GetTaskSnapshotOutput = z.infer<typeof GetTaskSnapshotOutputSchema>;

function readTail(path: string | null, lines: number): string | undefined {
	if (!path || !existsSync(path)) return undefined;
	let fd: number | undefined;
	try {
		const stat = statSync(path);
		const bytesToRead = Math.min(stat.size, MAX_TRANSCRIPT_BYTES);
		const start = Math.max(0, stat.size - bytesToRead);
		const buffer = Buffer.alloc(bytesToRead);
		fd = openSync(path, "r");
		readSync(fd, buffer, 0, bytesToRead, start);
		const tail = buffer.toString("utf8").split(/\r?\n/).slice(-lines).join("\n").trimEnd();
		return tail || undefined;
	} catch {
		return undefined;
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}

function specFields(spec_json: string | null): { objective?: string; cwd?: string } {
	if (!spec_json) return {};
	try {
		const parsed = TaskSpecSchema.safeParse(JSON.parse(spec_json));
		if (!parsed.success) return {};
		return {
			objective: parsed.data.objective,
			...(parsed.data.cwd ? { cwd: parsed.data.cwd } : {}),
		};
	} catch {
		return {};
	}
}

function artifactPath(payload: unknown): string | undefined {
	if (!payload || typeof payload !== "object") return undefined;
	const value = (payload as { artifact_path?: unknown }).artifact_path;
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

export async function runGetTaskSnapshot(
	ctx: CommandContext,
	input: GetTaskSnapshotInput,
): Promise<GetTaskSnapshotOutput> {
	const task = getTaskById(ctx.db, input.task_id);
	if (!task) {
		return {
			error: {
				code: "task_not_found",
				message: `task '${input.task_id}' not found`,
				retryable: false,
			},
		};
	}
	const limit = input.event_limit ?? DEFAULT_EVENT_LIMIT;
	const events = listTaskEvents(ctx.db, task.id);
	const latestEvents = events.slice(-limit);
	const latestHandoffs = events
		.filter((event) => event.type === "handoff")
		.slice(-limit)
		.map((event) => ({
			sequence: event.sequence,
			...(event.message ? { message_preview: event.message.slice(0, 200) } : {}),
			...(artifactPath(event.payload) ? { artifact_path: artifactPath(event.payload) } : {}),
			created_at: event.created_at,
		}));
	const activity = getTaskActivity(ctx.db, task);
	const transcriptTail = readTail(
		task.transcript_ref,
		input.transcript_lines ?? DEFAULT_TRANSCRIPT_LINES,
	);
	return {
		task_id: task.id,
		status: task.status,
		agent_kind: task.agent_kind,
		...(task.model ? { model: task.model } : {}),
		...(task.role ? { role: task.role } : {}),
		...specFields(task.spec_json),
		...taskRunMetadata(task),
		...(activity.last_event_at || activity.last_transcript_at || task.updated_at
			? {
					last_activity_at:
						activity.last_event_at ?? activity.last_transcript_at ?? task.updated_at,
				}
			: {}),
		latest_events: latestEvents,
		latest_handoffs: latestHandoffs,
		...(transcriptTail ? { transcript_tail: transcriptTail } : {}),
		suggested_next_read_actions: [
			"Inspect latest_events before steering.",
			"Open referenced handoff artifacts when latest_handoffs is non-empty.",
			"Read transcript_tail for recent terminal context.",
		],
	};
}
