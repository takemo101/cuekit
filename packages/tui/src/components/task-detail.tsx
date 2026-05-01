import type { TaskStatus, TaskSummary } from "@cuekit/core";
import type { ReactNode } from "react";
import type { TuiTaskEvent } from "../context.ts";
import type { TuiTaskDetail } from "../data.ts";
import { truncateEnd, truncateMiddle } from "../format.ts";
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
		/^[-─━]{8,}$/.test(trimmed) ||
		/^\?\s*for\s+shortcuts/i.test(trimmed) ||
		/^shift\+tab\s+to\s+cycle/i.test(trimmed) ||
		/^ctrl\+[^\s]+\s+to\s+expand/i.test(trimmed) ||
		normalized === "bypasspermissions" ||
		normalized === "stophook" ||
		/^tokens:\s*\d+/i.test(trimmed)
	);
}

function outputLines(detail: TuiTaskDetail | undefined): string[] {
	return (detail?.transcriptTail ?? []).filter((line) => !isOutputNoise(line));
}

function formatUpdatedAt(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
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

function metadataEntries(task: TaskSummary, detail: TuiTaskDetail | undefined): MetadataEntry[] {
	const role = detail?.status.role ?? task.role;
	const model = detail?.status.model ?? task.model;
	const roleSource = detail?.status.role_source ?? task.role_source;
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
	if (model) {
		entries.push({ label: "model", value: model, color: theme.cyan });
	}
	entries.push({ label: "transcript", value: pathLabel(detail?.transcriptPath), color: theme.cyan });
	if (detail?.status.last_event_at) {
		entries.push({
			label: "event",
			value: formatUpdatedAt(detail.status.last_event_at),
			color: theme.cyan,
		});
	}
	if (detail?.status.last_transcript_at) {
		entries.push({
			label: "output",
			value: formatUpdatedAt(detail.status.last_transcript_at),
			color: theme.cyan,
		});
	}
	const idleLabel = formatIdleMs(detail?.status.idle_ms);
	if (idleLabel) {
		entries.push({
			label: "idle",
			value: detail?.status.attention_hint
				? `${idleLabel} — ${detail.status.attention_hint}`
				: idleLabel,
			color: detail?.status.attention_hint ? theme.yellow : theme.muted,
		});
	}
	if (detail?.status.attach_hint) {
		entries.push({
			label: "attach",
			value: truncateMiddle(detail.status.attach_hint, 96),
			color: theme.purple,
		});
	}
	if (detail?.status.summary) {
		entries.push({
			label: "summary",
			value: truncateEnd(detail.status.summary, 110),
			color: theme.green,
		});
	}
	return entries;
}

function eventTypeColor(type: string): string {
	if (type === "completed") return theme.green;
	if (type === "failed" || type === "timed_out" || type === "blocked") return theme.red;
	if (type === "cancelled") return theme.yellow;
	if (type === "progress") return theme.cyan;
	return theme.purple;
}

export function contextHeight(metadata: MetadataEntry[], events: TuiTaskEvent[]): number {
	const eventRows = Math.max(1, events.length * 2);
	return Math.min(12, Math.max(4, metadata.length + 1 + eventRows));
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
	return (
		<box backgroundColor={theme.panelAlt} height={1}>
			<text fg={props.error ? theme.red : theme.cyan}>{label}</text>
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

function ContextPanel(props: {
	metadata: MetadataEntry[];
	events: TuiTaskEvent[];
	error?: string;
}): ReactNode {
	return (
		<scrollbox height={contextHeight(props.metadata, props.events)} flexShrink={1} viewportCulling>
			{props.metadata.map((entry) => (
				<MetadataRow key={entry.label} entry={entry} />
			))}
			<EventHeader count={props.events.length} error={props.error} />
			{props.error ? <text fg={theme.red}>{truncateEnd(props.error, 128)}</text> : null}
			{props.events.length === 0 && !props.error ? <text fg={theme.muted}>No events yet.</text> : null}
			{props.events.map((event) => (
				<EventRow key={event.sequence} event={event} />
			))}
		</scrollbox>
	);
}

export function TaskDetail(props: { task?: TaskSummary; detail?: TuiTaskDetail }): ReactNode {
	const { task, detail } = props;
	if (!task) {
		return (
			<box title="Detail" borderStyle="single" borderColor={theme.border} backgroundColor={theme.panel} flexGrow={2} padding={1}>
				<EmptyText>Select a task.</EmptyText>
			</box>
		);
	}

	const status = detail?.status.status ?? task.status;
	const events = detail?.events.slice(-2) ?? [];
	const lines = outputLines(detail);
	const isTerminal = ["completed", "failed", "cancelled", "timed_out", "blocked"].includes(status);
	const metadata = metadataEntries(task, detail);

	return (
		<box
			title={detailTitle(task, status)}
			borderStyle="single"
			borderColor={statusAccent(status)}
			backgroundColor={theme.panel}
			flexGrow={2}
			padding={1}
			flexDirection="column"
		>
			<ContextPanel metadata={metadata} events={events} error={detail?.eventsError} />
			{isTerminal ? (
				<>
					<box backgroundColor={theme.panelAlt} height={1} flexShrink={0}>
						<text fg={theme.cyan}>RESULT</text>
					</box>
					<text flexShrink={0}>{resultBlock(detail, status)}</text>
					<text flexShrink={0}> </text>
					<box backgroundColor={theme.panelAlt} height={1} flexShrink={0}>
						<text fg={theme.cyan}>{`TRANSCRIPT TAIL (${lines.length} line${lines.length === 1 ? "" : "s"})`}</text>
					</box>
					<scrollbox flexGrow={1} flexShrink={1} stickyScroll stickyStart="bottom" viewportCulling>
						<text fg={theme.text}>{
							lines.length > 0
								? lines.map((line) => truncateEnd(line, 150)).join("\n")
								: "No transcript output available."
						}</text>
					</scrollbox>
				</>
			) : (
				<>
					<box backgroundColor={theme.panelAlt} height={1} flexShrink={0}>
						<text fg={theme.cyan}>{`LIVE OUTPUT (${lines.length} line${lines.length === 1 ? "" : "s"})`}</text>
					</box>
					<scrollbox flexGrow={1} flexShrink={1} stickyScroll stickyStart="bottom" viewportCulling>
						<text fg={theme.text}>{
							lines.length > 0
								? lines.map((line) => truncateEnd(line, 150)).join("\n")
								: "No output available yet."
						}</text>
					</scrollbox>
				</>
			)}
		</box>
	);
}
