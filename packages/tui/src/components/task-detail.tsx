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

function eventLine(event: TuiTaskEvent): string {
	const sequence = `#${event.sequence}`.padEnd(6);
	const type = event.type.padEnd(12);
	const message = event.message ?? "";
	return truncateEnd(`${sequence}${type}${message}`, 128);
}

function formatUpdatedAt(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function detailTitle(task: TaskSummary, status: TaskStatus): string {
	return `Detail: ${statusGlyph(status)} ${task.task_id} / ${status} / ${task.agent_kind}`;
}

function metadataLines(task: TaskSummary, detail: TuiTaskDetail | undefined): string[] {
	const lines = [
		`updated     ${formatUpdatedAt(task.updated_at)}`,
		`transcript  ${pathLabel(detail?.transcriptPath)}`,
	];
	if (detail?.status.attach_hint) lines.push(`attach      ${truncateMiddle(detail.status.attach_hint, 96)}`);
	if (detail?.status.summary) lines.push(`summary     ${truncateEnd(detail.status.summary, 110)}`);
	return lines;
}

function eventsLines(events: TuiTaskEvent[], error: string | undefined): string[] {
	const suffix = error ? " — load error" : "";
	if (events.length === 0) {
		return ["EVENTS" + suffix, error ? `  ${truncateEnd(error, 128)}` : "  No events yet."];
	}
	return [`EVENTS (${events.length} shown)${suffix}`, ...events.map((event) => `  ${eventLine(event)}`)];
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
	const metadata = metadataLines(task, detail);
	const eventRows = eventsLines(events, detail?.eventsError);
	const contextRows = [...metadata, ...eventRows];
	const contextHeight = Math.min(6, Math.max(1, contextRows.length));

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
			<scrollbox height={contextHeight} flexShrink={1} viewportCulling>
				<text fg={theme.muted}>{contextRows.join("\n")}</text>
			</scrollbox>
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
