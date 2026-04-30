import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import type { TaskListFilter, TaskStatusView } from "@cuekit/core";
import type { TuiContext, TuiTaskEvent, TuiTaskListOutput } from "./context.ts";

type LoadTaskListOptions = Pick<
	TaskListFilter,
	"cwd" | "limit" | "status" | "agent_kind" | "session_id" | "cursor"
>;

export type TuiTaskDetail = {
	status: TaskStatusView;
	events: TuiTaskEvent[];
	eventsError?: string;
	transcriptPath?: string;
	transcriptTail: string[];
};

export async function loadTaskList(
	ctx: TuiContext,
	options: LoadTaskListOptions = {},
): Promise<TuiTaskListOutput> {
	return ctx.listTasks({ ...options, limit: options.limit ?? 100 });
}

export async function loadTaskDetail(
	ctx: TuiContext,
	taskId: string,
	options: { transcriptLines?: number } = {},
): Promise<TuiTaskDetail> {
	const [status, eventsResult] = await Promise.all([
		ctx.getTaskStatus(taskId),
		ctx.listTaskEvents(taskId),
	]);
	const transcriptPath = ctx.getTranscriptPath?.(taskId);
	const eventsError = "events" in eventsResult ? undefined : eventsResult.error.message;
	return {
		status,
		events: "events" in eventsResult ? eventsResult.events : [],
		...(eventsError ? { eventsError } : {}),
		...(transcriptPath ? { transcriptPath } : {}),
		transcriptTail: readTranscriptTail(transcriptPath, options.transcriptLines ?? 80),
	};
}

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const ANSI_CSI_RE = new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, "g");
const ANSI_OSC_RE = new RegExp(`${ESC}\\][^${BEL}]*(?:${BEL}|${ESC}\\\\)`, "g");

function stripControlCharacters(value: string): string {
	return Array.from(value)
		.filter((char) => {
			const code = char.charCodeAt(0);
			return code === 10 || (code >= 32 && code !== 127 && !(code >= 0x80 && code <= 0x9f));
		})
		.join("");
}

export function sanitizeTerminalText(value: string): string {
	return stripControlCharacters(value.replace(ANSI_OSC_RE, "").replace(ANSI_CSI_RE, "")).trimEnd();
}

function isLowValueTranscriptLine(line: string): boolean {
	const trimmed = line.trim();
	if (trimmed.length === 0) return true;
	return trimmed.length <= 2 && !/[\p{L}\p{N}]/u.test(trimmed);
}

export function readTranscriptTail(
	path: string | undefined,
	maxLines = 80,
	maxBytes = 64 * 1024,
): string[] {
	if (!path || maxLines <= 0 || maxBytes <= 0 || !existsSync(path)) return [];
	let fd: number | undefined;
	try {
		const size = statSync(path).size;
		const bytesToRead = Math.min(size, maxBytes);
		const start = Math.max(0, size - bytesToRead);
		const buffer = Buffer.alloc(bytesToRead);
		fd = openSync(path, "r");
		readSync(fd, buffer, 0, bytesToRead, start);
		return buffer
			.toString("utf8")
			.split(/\r?\n/)
			.map(sanitizeTerminalText)
			.filter((line) => !isLowValueTranscriptLine(line))
			.slice(-maxLines);
	} catch {
		return [];
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}
