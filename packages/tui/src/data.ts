import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import type { TaskListFilter, TaskStatusView, TaskSummary, TeamSummary } from "@cuekit/core";
import type {
	TuiContext,
	TuiManualSteerHint,
	TuiTaskEvent,
	TuiTaskListOutput,
	TuiTeamAttentionItem,
	TuiTeamListOutput,
	TuiTeamStatusOutput,
} from "./context.ts";

type LoadTaskListOptions = Pick<
	TaskListFilter,
	"cwd" | "project_root" | "limit" | "status" | "agent_kind" | "session_id" | "cursor"
>;

export type TuiTaskDetail = {
	status: TaskStatusView;
	events: TuiTaskEvent[];
	eventsError?: string;
	teamAttentionItems?: TuiTeamAttentionItem[];
	manualSteerHints?: TuiManualSteerHint[];
	teamStatusError?: string;
	transcriptPath?: string;
	transcriptTail: string[];
};

export async function loadTaskList(
	ctx: TuiContext,
	options: LoadTaskListOptions = {},
): Promise<TuiTaskListOutput> {
	return ctx.listTasks({ ...options, limit: options.limit ?? 100 });
}

export async function loadTeamList(
	ctx: TuiContext,
	options: {
		session_id?: string;
		cwd?: string;
		project_root?: string;
		project_scope?: { project_uid?: string; project_root: string };
		project_uid?: string;
		limit?: number;
		cursor?: string;
	} = {},
): Promise<TuiTeamListOutput> {
	if (!ctx.listTeams) return { teams: [], has_more: false };
	return ctx.listTeams({ ...options, limit: options.limit ?? 100 });
}

export type TuiTeamDetail = {
	team: TeamSummary;
	status?: Exclude<TuiTeamStatusOutput, { error: unknown }>;
	members: TaskSummary[];
	lanes: Partial<Record<string, TaskSummary[]>>;
	attentionItems?: TuiTeamAttentionItem[];
	manualSteerHints?: TuiManualSteerHint[];
	error?: string;
};

function groupMembersByLane(members: TaskSummary[]): Partial<Record<string, TaskSummary[]>> {
	const lanes: Partial<Record<string, TaskSummary[]>> = {};
	for (const member of members) {
		const lane = member.position ?? "unpositioned";
		lanes[lane] = [...(lanes[lane] ?? []), member];
	}
	return lanes;
}

export async function loadTeamDetail(ctx: TuiContext, team: TeamSummary): Promise<TuiTeamDetail> {
	const statusResult = ctx.getTeamStatus ? await ctx.getTeamStatus(team.team_id) : undefined;
	if (statusResult && "error" in statusResult) {
		return { team, members: [], lanes: {}, error: statusResult.error.message };
	}
	const status = statusResult;
	let members = status?.tasks ?? [];
	if (members.length === 0) {
		const taskList = await ctx.listTasks({ team_id: team.team_id, limit: 100 });
		members = "tasks" in taskList ? taskList.tasks : [];
	}
	const detail: TuiTeamDetail = {
		team,
		...(status ? { status } : {}),
		members,
		lanes: groupMembersByLane(members),
	};
	const runSummary = status?.run_summary;
	if (runSummary?.attention_items && runSummary.attention_items.length > 0) {
		detail.attentionItems = runSummary.attention_items;
	}
	if (runSummary?.manual_steer_hints && runSummary.manual_steer_hints.length > 0) {
		detail.manualSteerHints = runSummary.manual_steer_hints;
	}
	return detail;
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
	const teamStatusResult =
		status.team_id && ctx.getTeamStatus ? await ctx.getTeamStatus(status.team_id) : undefined;
	const transcriptPath = ctx.getTranscriptPath?.(taskId);
	const eventsError = "events" in eventsResult ? undefined : eventsResult.error.message;
	const teamStatusError =
		teamStatusResult && "error" in teamStatusResult ? teamStatusResult.error.message : undefined;
	const teamRunSummary =
		teamStatusResult && "run_summary" in teamStatusResult
			? teamStatusResult.run_summary
			: undefined;
	return {
		status,
		events: "events" in eventsResult ? eventsResult.events : [],
		...(eventsError ? { eventsError } : {}),
		...(teamRunSummary?.attention_items && teamRunSummary.attention_items.length > 0
			? { teamAttentionItems: teamRunSummary.attention_items }
			: {}),
		...(teamRunSummary?.manual_steer_hints && teamRunSummary.manual_steer_hints.length > 0
			? { manualSteerHints: teamRunSummary.manual_steer_hints }
			: {}),
		...(teamStatusError ? { teamStatusError } : {}),
		...(transcriptPath ? { transcriptPath } : {}),
		transcriptTail: readTranscriptTail(transcriptPath, options.transcriptLines ?? 80),
	};
}

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const ANSI_CSI_RE = new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, "g");
const ANSI_OSC_RE = new RegExp(`${ESC}\\][^${BEL}]*(?:${BEL}|${ESC}\\\\)`, "g");
const ANSI_STRING_RE = new RegExp(`${ESC}[PX^_][\\s\\S]*?${ESC}\\\\`, "g");
const ANSI_ST_RE = new RegExp(`${ESC}\\\\`, "g");
const BARE_CURSOR_VISIBILITY_RE = /\[\?25[lh]/g;
const TERMINAL_REPAINT_GLYPHS_RE = /[■⬝┃]+/g;

function stripControlCharacters(value: string): string {
	return Array.from(value)
		.filter((char) => {
			const code = char.charCodeAt(0);
			return code === 10 || (code >= 32 && code !== 127 && !(code >= 0x80 && code <= 0x9f));
		})
		.join("");
}

export function sanitizeTerminalText(value: string): string {
	return stripControlCharacters(
		value
			.replace(ANSI_STRING_RE, "")
			.replace(ANSI_OSC_RE, "")
			.replace(ANSI_CSI_RE, "")
			.replace(ANSI_ST_RE, "")
			.replace(BARE_CURSOR_VISIBILITY_RE, "")
			.replace(TERMINAL_REPAINT_GLYPHS_RE, ""),
	).trimEnd();
}

function isLowValueTranscriptLine(line: string): boolean {
	const trimmed = line.trim();
	if (trimmed.length === 0) return true;
	if (trimmed.length <= 2 && !/[\p{L}\p{N}]/u.test(trimmed)) return true;
	return (
		/^ran\s+\d+\s+stop hooks(?:\s*\([^)]*\))?$/i.test(trimmed) ||
		/^stop hook prevented continuation$/i.test(trimmed) ||
		/^[⏵>»\s]*bypass\s*permissions\s*on(?:\s*\([^)]*\))?$/i.test(trimmed) ||
		/^\(?shift\+tab\s+to\s+cycle\)?$/i.test(trimmed) ||
		/^tokens:\s*\d+$/i.test(trimmed) ||
		/^[-*•]\s*if\s*mcp\s*is\s*unavailable,\s*use\s*the\s*cli\s*fallback:\s*cuekit\s*tool\s*report\s*--type\s*<progress\|completed>\s*$/i.test(
			trimmed,
		) ||
		/^[-*•]\s*cuekit_task_id\s*and\s*cuekit_child_token\s*are\s*already\s*provided\s*in\s*your\s*environment;\s*do\s*not\s*print\s*$/i.test(
			trimmed,
		) ||
		/^[-*•]\s*reporting\s*does\s*not\s*automatically\s*close\s*$/i.test(trimmed) ||
		/^[-*•]\s*transcript\s*markers\s*and\s*direct\s*result\s*$/i.test(trimmed)
	);
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
