import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import {
	isTerminalTaskStatus,
	type TaskListFilter,
	type TaskStatusView,
	type TaskSummary,
	type TeamSummary,
} from "@cuekit/core";
import { getTmuxSessionName } from "./attach.ts";
import type {
	TuiContext,
	TuiManualSteerHint,
	TuiTaskEvent,
	TuiTaskListOutput,
	TuiTeamAttentionItem,
	TuiTeamListInput,
	TuiTeamListOutput,
	TuiTeamStatusOutput,
} from "./context.ts";

// Single source of truth for the transcript pane's height. Used by both
// the data fetch (how many lines to slice) and the render-time padding
// (so the scrollbox sees a constant content height — see #377). Kept
// here rather than in `task-detail.tsx` so they cannot drift apart.
export const DEFAULT_TRANSCRIPT_LINES = 80;

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
	options: TuiTeamListInput = {},
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
	const maxLines = options.transcriptLines ?? DEFAULT_TRANSCRIPT_LINES;
	const transcriptTail = await resolveTranscriptTail(status, transcriptPath, maxLines);
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
		transcriptTail,
	};
}

// Decide between the live tmux pane snapshot and the persisted transcript
// file. For running tasks with a known tmux session, prefer capture-pane —
// it returns the current rendered screen (what a human attaching would
// see) rather than the raw redraw history that piles up in the file. For
// terminal tasks, or when the session is unknown / the capture fails for
// any reason, fall back to the existing file-tail path so postmortem
// reading still works.
//
// Async because the live-pane probe spawns tmux off the event loop;
// loadTaskDetail already awaits, so this addition is transparent to the
// TUI render path. Keeping the spawn off the synchronous critical path
// matters because auto-refresh fires this every few seconds and a busy
// tmux server (heavy IO, many sessions) would otherwise stall the TUI.
export async function resolveTranscriptTail(
	status: TaskStatusView,
	transcriptPath: string | undefined,
	maxLines: number,
): Promise<string[]> {
	if (!isTerminalTaskStatus(status.status)) {
		const sessionName = getTmuxSessionName(status);
		if (sessionName) {
			const live = await captureLivePaneTail(sessionName, maxLines);
			if (live !== null) return live;
		}
	}
	return readTranscriptTail(transcriptPath, maxLines);
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

// `tmux capture-pane -p -J -S -<N>` returns the **current rendered screen**
// of the live tmux pane, not the raw redraw history that gets piped into
// the persisted transcript file. For frequently-redrawing TUI children
// (Gemini CLI, opencode TUI, ...) the file-tail mostly captures cursor-
// move / clear escapes; capture-pane returns the post-render content the
// human would actually see. We still strip residual control characters
// here because OpenTUI renders text components as plain strings (no
// built-in escape parser); color preservation is a separate follow-up
// that would require building a StyledText conversion path.
//
// Why the numbers:
// - `captureLines = 200`: pull 200 lines from history (`-S -200`) so we
//   have margin above the visible viewport for users that grow the TUI
//   pane vertically. tmux clamps to whatever exists in the buffer, so a
//   shorter pane just returns what is there.
// - `maxLines` defaults to `DEFAULT_TRANSCRIPT_LINES` and is the upper
//   bound on what we hand back to the renderer (matches `loadTaskDetail`'s
//   default and the scrollbox's stable padding height).
//
// We deliberately do NOT apply `isLowValueTranscriptLine` here: that
// filter was tuned for the file-tail path, where the persisted transcript
// is dominated by re-rendered UI chrome and known stop-hook noise. The
// capture-pane output is the post-render screen the human actually sees,
// so dropping lines from it would hide content the user is staring at.
//
// Returns `null` on any failure mode that should fall back to the file
// tail: tmux missing, session does not exist, capture-pane exits non-
// zero, throw during spawn, or the captured screen is entirely empty.
// Treating "successful but empty" as null lets the caller show
// postmortem content during the brief window before the child has
// drawn anything to the pane.
export async function captureLivePaneTail(
	sessionName: string,
	maxLines = DEFAULT_TRANSCRIPT_LINES,
	options: { tmuxBin?: string; captureLines?: number } = {},
): Promise<string[] | null> {
	const tmuxBin = options.tmuxBin ?? "tmux";
	const captureLines = options.captureLines ?? 200;
	try {
		const proc = Bun.spawn(
			[tmuxBin, "capture-pane", "-p", "-J", "-S", `-${captureLines}`, "-t", sessionName],
			{ stdout: "pipe", stderr: "ignore" },
		);
		const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
		if (exitCode !== 0) return null;
		const lines = stdout.split(/\r?\n/).map(sanitizeTerminalText);
		// Drop trailing empty lines tmux capture-pane uses to fill the
		// viewport; if everything was empty/whitespace, fall back.
		while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
		if (lines.length === 0) return null;
		return lines.slice(-maxLines);
	} catch {
		return null;
	}
}
