import type { TaskStatus, TaskSummary } from "@cuekit/core";
import type { ReactNode } from "react";
import { detailTabTitleHint, TASK_DETAIL_TABS } from "./detail-tabs.tsx";
import type { TuiTaskEvent } from "../context.ts";
import { DEFAULT_TRANSCRIPT_LINES, type TuiTaskDetail } from "../data.ts";
import { truncateEnd, truncateMiddle } from "../format.ts";
import type { TaskDetailTab } from "../tui-state.ts";
import { statusAccent, statusGlyph, theme } from "../theme.ts";

function pathLabel(path: string | undefined): string {
	if (!path) return "No transcript yet";
	const cuekitIndex = path.indexOf(".cuekit/tasks/");
	return truncateMiddle(cuekitIndex >= 0 ? path.slice(cuekitIndex) : path, 96);
}

function isOutputNoise(line: string): boolean {
	const trimmed = line.trim();
	const normalized = trimmed.toLowerCase().replaceAll(" ", "");
	return (
		trimmed === "" ||
		trimmed === "─" ||
		/^[-─━═]+$/.test(trimmed) ||
		normalized === "escnavigate" ||
		normalized === "ctrl+oinput" ||
		normalized === "shift+tabprev" ||
		normalized === "tabnext" ||
		normalized === "entersend" ||
		normalized === "ctrl+jnewline" ||
		normalized === "ctrl+ccancel"
	);
}

function outputLines(detail: TuiTaskDetail | undefined): string[] {
	return (detail?.transcriptTail ?? []).filter((line) => !isOutputNoise(line));
}

const LIVE_OUTPUT_PADDING_HEAD = "── (no earlier pane content) ──";

export function padLinesForLiveOutput(lines: string[], targetHeight: number): string[] {
	if (targetHeight <= 0) return lines;
	if (lines.length >= targetHeight) return lines.slice(-targetHeight);
	const padCount = targetHeight - lines.length;
	const padding = new Array<string>(padCount).fill("");
	if (padCount >= 1) padding[0] = LIVE_OUTPUT_PADDING_HEAD;
	return [...padding, ...lines];
}

const LIVE_OUTPUT_TARGET_HEIGHT = DEFAULT_TRANSCRIPT_LINES;

function formatUpdatedAt(value: string | undefined): string {
	if (!value) return "unknown";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return date.toLocaleTimeString();
}

function formatIdleMs(value: number | undefined): string | undefined {
	if (value === undefined) return undefined;
	if (value < 1000) return `${value}ms`;
	if (value < 60_000) return `${Math.round(value / 1000)}s`;
	return `${Math.round(value / 60_000)}m`;
}

function detailTitle(task: TaskSummary, status: TaskStatus): string {
	return `Detail: ${statusGlyph(status)} ${task.task_id} / ${status} / ${task.agent_kind}`;
}

type MetadataEntry = { label: string; value: string; color?: string };
type AttentionEntry = { sequence: number; type: string; message: string; color?: string };

const ATTENTION_EVENT_TYPES = new Set(["completed", "failed", "blocked", "help_requested"]);

export function attentionEntries(detail: TuiTaskDetail | undefined): AttentionEntry[] {
	if (detail?.teamStatusError) {
		return [
			{
				sequence: 0,
				type: "team_status",
				message: `team status error: ${detail.teamStatusError}`,
				color: theme.red,
			},
		];
	}
	if (detail?.teamAttentionItems && detail.teamAttentionItems.length > 0) {
		return detail.teamAttentionItems.slice(-3).map((item) => {
			const hasManualSteerHint = detail.manualSteerHints?.some(
				(hint) => hint.attention_sequence === item.sequence,
			);
			const message = item.message_preview ?? item.message ?? item.full_message ?? "";
			return {
				sequence: item.sequence,
				type: item.type,
				message: `${item.position ? `${item.position}: ` : ""}${message}${hasManualSteerHint ? " ↪ steer hint" : ""}`,
				color: eventTypeColor(item.type),
			};
		});
	}
	if (!detail || detail.status.position === "coordinator") return [];
	return detail.events
		.filter((event) => ATTENTION_EVENT_TYPES.has(event.type))
		.slice(-3)
		.map((event) => ({
			sequence: event.sequence,
			type: event.type,
			message: event.message ?? "",
			color: eventTypeColor(event.type),
		}));
}

export function metadataEntries(
	task: TaskSummary,
	detail: TuiTaskDetail | undefined,
): MetadataEntry[] {
	const role = detail?.status.role ?? task.role;
	const model = detail?.status.model ?? task.model;
	const roleSource = detail?.status.role_source ?? task.role_source;
	const adapterMode = detail?.status.metadata?.adapter_mode;
	const teamId = detail?.status.team_id ?? task.team_id;
	const position = detail?.status.position ?? task.position;
	const entries: MetadataEntry[] = [
		{ label: "updated", value: formatUpdatedAt(task.updated_at), color: theme.yellow },
	];
	if (role) {
		entries.push({
			label: "role",
			value: `${role}${roleSource ? ` (${roleSource})` : ""}`,
			color: theme.purple,
		});
	}
	if (model) entries.push({ label: "model", value: model, color: theme.cyan });
	if (typeof adapterMode === "string" && adapterMode.length > 0) {
		entries.push({
			label: "mode",
			value: adapterMode,
			color: adapterMode === "batch" ? theme.yellow : theme.cyan,
		});
	}
	if (teamId) entries.push({ label: "team", value: teamId, color: theme.purple });
	if (detail?.teamStatusError) {
		entries.push({ label: "team status", value: truncateEnd(detail.teamStatusError, 110), color: theme.red });
	}
	if (position) entries.push({ label: "position", value: position, color: theme.purple });
	entries.push({ label: "transcript", value: pathLabel(detail?.transcriptPath), color: theme.cyan });
	if (detail?.status.last_event_at) entries.push({ label: "event", value: formatUpdatedAt(detail.status.last_event_at), color: theme.cyan });
	if (detail?.status.last_transcript_at) entries.push({ label: "output", value: formatUpdatedAt(detail.status.last_transcript_at), color: theme.cyan });
	const idleLabel = formatIdleMs(detail?.status.idle_ms);
	if (idleLabel) {
		entries.push({
			label: "idle",
			value: detail?.status.attention_hint ? `${idleLabel} — ${detail.status.attention_hint}` : idleLabel,
			color: detail?.status.attention_hint ? theme.yellow : theme.muted,
		});
	}
	const paneBackendKind = detail?.status.metadata?.pane_backend_kind;
	if (typeof paneBackendKind === "string") {
		const mismatch = detail?.status.metadata?.pane_backend_mismatch === true;
		entries.push({
			label: "backend",
			value: mismatch ? `${paneBackendKind} (config mismatch; attach only)` : paneBackendKind,
			color: mismatch ? theme.yellow : theme.muted,
		});
	}
	if (detail?.status.supports_attach === true && detail.status.attach_hint) {
		entries.push({ label: "attach", value: truncateMiddle(detail.status.attach_hint, 96), color: theme.purple });
	}
	if (detail?.status.summary) entries.push({ label: "summary", value: truncateEnd(detail.status.summary, 110), color: theme.green });
	return entries;
}

function eventTypeColor(type: string): string {
	if (type === "completed") return theme.green;
	if (type === "failed" || type === "timed_out" || type === "blocked") return theme.red;
	if (type === "cancelled") return theme.yellow;
	if (type === "progress") return theme.cyan;
	return theme.purple;
}

export function contextHeight(
	metadata: MetadataEntry[],
	events: TuiTaskEvent[],
	attention: AttentionEntry[] = [],
): number {
	const eventRows = Math.max(1, events.length * 2);
	const attentionRows = attention.length > 0 ? attention.length + 1 : 0;
	return Math.min(12, Math.max(4, metadata.length + 1 + eventRows + attentionRows));
}

export function teamContextPanelHeight(input: {
	attentionCount: number;
	hintCount: number;
	hasError?: boolean;
}): number {
	const visibleHints = input.hintCount > 0 ? Math.min(input.hintCount, 3) : 1;
	const rows =
		1 + // TEAM CONTEXT header
		(input.hasError ? 1 : 0) +
		1 + // ATTENTION header or empty state
		input.attentionCount +
		1 + // STEER HINTS header
		visibleHints +
		1; // deferred snippets note
	return Math.min(12, Math.max(4, rows));
}

function terminalEvent(detail: TuiTaskDetail | undefined): TuiTaskEvent | undefined {
	return detail?.events.findLast((event) =>
		["completed", "failed", "cancelled", "timed_out", "blocked"].includes(event.type),
	);
}

function resultBlock(detail: TuiTaskDetail | undefined, status: TaskStatus): string {
	const event = terminalEvent(detail);
	if (event?.message) return truncateEnd(event.message, 150);
	if (status === "completed") return "Completed. No result message reported.";
	return `${status}. No result message reported.`;
}

function EmptyText(props: { children: string }): ReactNode {
	return <text fg={theme.muted}>{props.children}</text>;
}

function MetadataRow(props: { entry: MetadataEntry }): ReactNode {
	return (
		<box flexDirection="row" height={1}>
			<text fg={props.entry.color ?? theme.cyan} width={12}>{props.entry.label}</text>
			<text fg={theme.text}>{props.entry.value}</text>
		</box>
	);
}

function EventHeader(props: { count: number; error?: string }): ReactNode {
	const label = props.error ? "EVENTS — load error" : `EVENTS (${props.count} shown)`;
	return SectionHeader({ label, color: props.error ? theme.red : theme.cyan });
}

function AttentionHeader(props: { count: number }): ReactNode {
	return SectionHeader({ label: `ATTENTION (${props.count} shown)`, color: theme.yellow });
}
function AttentionRow(props: { entry: AttentionEntry }): ReactNode {
	return (
		<box flexDirection="row" height={1}>
			<text fg={theme.muted} width={7}>{`#${props.entry.sequence}`}</text>
			<text fg={props.entry.color ?? theme.yellow} width={13}>{props.entry.type}</text>
			<text fg={theme.text}>{truncateEnd(props.entry.message, 110)}</text>
		</box>
	);
}

function EventRow(props: { event: TuiTaskEvent }): ReactNode {
	return (
		<box flexDirection="row" height={1}>
			<text fg={theme.muted} width={7}>{`#${props.event.sequence}`}</text>
			<text fg={eventTypeColor(props.event.type)} width={13}>{props.event.type}</text>
			<text fg={theme.text}>{truncateEnd(props.event.message ?? "", 110)}</text>
		</box>
	);
}

function SectionHeader(props: { label: string; color?: string }): ReactNode {
	return (
		<box backgroundColor={theme.panelAlt} height={1}>
			<text fg={props.color ?? theme.cyan}>{props.label}</text>
		</box>
	);
}

function MetadataPanel(props: { metadata: MetadataEntry[] }): ReactNode {
	return (
		<scrollbox height={Math.min(12, Math.max(4, props.metadata.length + 2))} flexShrink={1} viewportCulling>
			{SectionHeader({ label: "OVERVIEW" })}
			{props.metadata.map((entry) => MetadataRow({ entry }))}
		</scrollbox>
	);
}

function EventsPanel(props: { events: TuiTaskEvent[]; error?: string }): ReactNode {
	return (
		<scrollbox height={Math.min(12, Math.max(4, props.events.length + 2))} flexShrink={1} viewportCulling>
			{EventHeader({ count: props.events.length, error: props.error })}
			{props.error ? <text fg={theme.red}>{truncateEnd(props.error, 128)}</text> : null}
			{props.events.length === 0 && !props.error ? <text fg={theme.muted}>No events yet.</text> : null}
			{props.events.map((event) => EventRow({ event }))}
		</scrollbox>
	);
}

function ContextPanel(props: { attention: AttentionEntry[]; detail?: TuiTaskDetail; error?: string }): ReactNode {
	const hints = props.detail?.manualSteerHints ?? [];
	return (
		<scrollbox
			height={teamContextPanelHeight({
				attentionCount: props.attention.length,
				hintCount: hints.length,
				hasError: Boolean(props.error),
			})}
			flexShrink={1}
			viewportCulling
		>
			{SectionHeader({ label: "TEAM CONTEXT", color: theme.yellow })}
			{props.error ? <text fg={theme.red}>{truncateEnd(props.error, 128)}</text> : null}
			{props.attention.length > 0 ? AttentionHeader({ count: props.attention.length }) : <text fg={theme.muted}>No team attention snippets.</text>}
			{props.attention.map((entry) => AttentionRow({ entry }))}
			<text fg={theme.cyan}>{`STEER HINTS ${hints.length}`}</text>
			{hints.length === 0 ? (
				<text fg={theme.muted}>No manual steer hints.</text>
			) : (
				hints.slice(0, 3).map((hint) => (
					<text key={`${hint.attention_sequence}:${hint.task_id}`} fg={theme.muted}>
						{truncateEnd(`${hint.position ?? "?"} ${hint.task_id}: ${hint.suggested_message}`, 110)}
					</text>
				))
			)}
			<text fg={theme.muted}>Handoff/blackboard snippets deferred.</text>
		</scrollbox>
	);
}

function OutputPanel(props: { detail?: TuiTaskDetail; status: TaskStatus; lines: string[] }): ReactNode {
	const isTerminal = ["completed", "failed", "cancelled", "timed_out", "blocked"].includes(props.status);
	return isTerminal ? (
		<>
			<box flexShrink={0}>{SectionHeader({ label: "RESULT" })}</box>
			<text flexShrink={0}>{resultBlock(props.detail, props.status)}</text>
			<text flexShrink={0}> </text>
			<box flexShrink={0}>{SectionHeader({ label: `TRANSCRIPT TAIL (${props.lines.length} line${props.lines.length === 1 ? "" : "s"})` })}</box>
			<scrollbox flexGrow={1} flexShrink={1} stickyScroll stickyStart="bottom" viewportCulling>
				<text fg={theme.text}>{props.lines.length > 0 ? props.lines.map((line) => truncateEnd(line, 150)).join("\n") : "No transcript output available."}</text>
			</scrollbox>
		</>
	) : (
		<>
			<box flexShrink={0}>
				{SectionHeader({
					label: `LIVE OUTPUT (${props.lines.length} line${props.lines.length === 1 ? "" : "s"}, ${
						props.detail?.transcriptSource === "live" ? "live pane" : "transcript file"
					})`,
				})}
			</box>
			<scrollbox flexGrow={1} flexShrink={1} stickyScroll stickyStart="bottom" viewportCulling>
				<text fg={theme.text}>{props.lines.length > 0 ? padLinesForLiveOutput(props.lines, LIVE_OUTPUT_TARGET_HEIGHT).map((line) => truncateEnd(line, 150)).join("\n") : "No output available yet."}</text>
			</scrollbox>
		</>
	);
}

export function TaskDetail(props: {
	task?: TaskSummary;
	detail?: TuiTaskDetail;
	activeTab?: TaskDetailTab;
	loadingDetail?: boolean;
	loadingFrame?: string;
}): ReactNode {
	const { task, detail, activeTab = "overview", loadingDetail, loadingFrame } = props;
	if (!task) {
		return (
			<box title="Detail" borderStyle="single" borderColor={theme.border} backgroundColor={theme.panel} flexGrow={2} padding={1}>
				<EmptyText>Select a task.</EmptyText>
			</box>
		);
	}

	const status = detail?.status.status ?? task.status;
	const events = detail?.events.slice(-8) ?? [];
	const lines = outputLines(detail);
	const metadata = metadataEntries(task, detail);
	const attention = attentionEntries(detail);

	return (
		<box
			title={`${detailTitle(task, status)} | ${detailTabTitleHint(TASK_DETAIL_TABS, activeTab)}`}
			borderStyle="single"
			borderColor={statusAccent(status)}
			backgroundColor={theme.panel}
			flexGrow={2}
			padding={1}
			flexDirection="column"
		>
			{loadingDetail ? <text fg={theme.yellow}>{`${loadingFrame ?? "⠋"} Loading detail…`}</text> : null}
			{activeTab === "overview" ? MetadataPanel({ metadata }) : null}
			{activeTab === "events" ? EventsPanel({ events, error: detail?.eventsError }) : null}
			{activeTab === "output" ? OutputPanel({ detail, status, lines }) : null}
			{activeTab === "context" ? ContextPanel({ attention, detail, error: detail?.teamStatusError }) : null}
		</box>
	);
}
