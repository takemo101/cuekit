import { existsSync, readFileSync } from "node:fs";
import { getTaskById } from "@cuekit/store";
import type { CommandContext } from "../command-context.ts";
import { runGetTaskStatus, type GetTaskStatusOutput } from "../commands/get-task-status.ts";
import { runListTaskEvents } from "../commands/list-task-events.ts";
import { runListTasks, type ListTasksInput, type ListTasksOutput } from "../commands/list-tasks.ts";

type LoadTaskListOptions = Pick<
	ListTasksInput,
	"cwd" | "limit" | "status" | "agent_kind" | "session_id" | "cursor"
>;

export type TuiTaskEvent = {
	sequence: number;
	id: string;
	task_id: string;
	type: string;
	message: string | null;
	payload: unknown | null;
	created_at: string;
};

export type TuiTaskDetail = {
	status: GetTaskStatusOutput;
	events: TuiTaskEvent[];
	transcriptPath?: string;
	transcriptTail: string[];
};

export async function loadTaskList(
	ctx: CommandContext,
	options: LoadTaskListOptions = {},
): Promise<ListTasksOutput> {
	return runListTasks(ctx, { ...options, limit: options.limit ?? 100 });
}

export async function loadTaskDetail(
	ctx: CommandContext,
	taskId: string,
	options: { transcriptLines?: number } = {},
): Promise<TuiTaskDetail> {
	const [status, eventsResult] = await Promise.all([
		runGetTaskStatus(ctx, { task_id: taskId }),
		runListTaskEvents(ctx, { task_id: taskId }),
	]);
	const task = getTaskById(ctx.db, taskId);
	const transcriptPath = task?.transcript_ref ?? undefined;
	return {
		status,
		events: "events" in eventsResult ? eventsResult.events : [],
		...(transcriptPath ? { transcriptPath } : {}),
		transcriptTail: readTranscriptTail(transcriptPath, options.transcriptLines ?? 80),
	};
}

export function readTranscriptTail(path: string | undefined, maxLines = 80): string[] {
	if (!path || maxLines <= 0 || !existsSync(path)) return [];
	try {
		return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).slice(-maxLines);
	} catch {
		return [];
	}
}
