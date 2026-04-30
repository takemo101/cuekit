import type { TaskStatus, TaskSummary } from "@cuekit/core";
import type { ReactNode } from "react";
import type { TuiTaskEvent } from "../context.ts";
import type { TuiTaskDetail } from "../data.ts";

const MUTED = "#565f89";
const BLUE = "#7dcfff";
const PURPLE = "#bb9af7";
const GREEN = "#9ece6a";
const RED = "#f7768e";
const YELLOW = "#e0af68";

function truncateMiddle(value: string, maxLength: number): string {
	if (value.length <= maxLength) return value;
	if (maxLength <= 3) return value.slice(0, maxLength);
	const keep = maxLength - 3;
	const start = Math.ceil(keep / 2);
	const end = Math.floor(keep / 2);
	return `${value.slice(0, start)}...${value.slice(value.length - end)}`;
}

function truncateEnd(value: string, maxLength: number): string {
	if (value.length <= maxLength) return value;
	return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function statusColor(status: string): string {
	if (status === "completed") return GREEN;
	if (status === "failed" || status === "timed_out" || status === "blocked") return RED;
	if (status === "cancelled") return YELLOW;
	return BLUE;
}

function pathLabel(path: string | undefined): string {
	if (!path) return "No transcript yet";
	const cuekitIndex = path.indexOf(".cuekit/tasks/");
	return truncateMiddle(cuekitIndex >= 0 ? path.slice(cuekitIndex) : path, 96);
}

function isReportBoilerplate(line: string): boolean {
	return (
		line.startsWith("ok:") ||
		line.startsWith("task_id:") ||
		line.startsWith("event_id:") ||
		line.startsWith("type:") ||
		line.startsWith("status:")
	);
}

function isOutputNoise(line: string): boolean {
	const normalized = line.toLowerCase().replaceAll(" ", "");
	return (
		isReportBoilerplate(line) ||
		/^[-─━]{8,}$/.test(line.trim()) ||
		/^\d+$/.test(line.trim()) ||
		normalized.includes("bypasspermissions") ||
		normalized.includes("stophook") ||
		normalized.includes("tokens") ||
		normalized.includes("shift+tabtocycle") ||
		normalized.includes("ctrl+toexpand")
	);
}

function liveOutputLines(detail: TuiTaskDetail | undefined): string[] {
	return (detail?.transcriptTail ?? []).filter((line) => !isOutputNoise(line)).slice(-16);
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

function metadataBlock(task: TaskSummary, detail: TuiTaskDetail | undefined, status: TaskStatus): string {
	const lines = [
		`${task.task_id}  ${task.agent_kind}`,
		`status      ${status}`,
		`updated     ${formatUpdatedAt(task.updated_at)}`,
		`transcript  ${pathLabel(detail?.transcriptPath)}`,
	];
	if (detail?.status.attach_hint) lines.push(`attach      ${truncateMiddle(detail.status.attach_hint, 96)}`);
	if (detail?.status.summary) lines.push(`summary     ${truncateEnd(detail.status.summary, 110)}`);
	return lines.join("\n");
}

function eventsBlock(events: TuiTaskEvent[]): string {
	if (events.length === 0) return "EVENTS\n  No events yet.";
	return [`EVENTS (${events.length} shown)`, ...events.map((event) => `  ${eventLine(event)}`)].join("\n");
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
	return <text fg={MUTED}>{props.children}</text>;
}

export function TaskDetail(props: { task?: TaskSummary; detail?: TuiTaskDetail }): ReactNode {
	const { task, detail } = props;
	if (!task) {
		return (
			<box borderStyle="rounded" flexGrow={2} padding={1}>
				<EmptyText>Select a task.</EmptyText>
			</box>
		);
	}

	const status = detail?.status.status ?? task.status;
	const events = detail?.events.slice(-7) ?? [];
	const lines = liveOutputLines(detail);
	const isTerminal = ["completed", "failed", "cancelled", "timed_out", "blocked"].includes(status);

	return (
		<box borderStyle="rounded" flexGrow={2} padding={1} flexDirection="column">
			<text fg={statusColor(status)}>{metadataBlock(task, detail, status)}</text>
			<text> </text>
			<text fg={PURPLE}>{eventsBlock(events)}</text>
			<text> </text>
			{isTerminal ? (
				<>
					<text fg={BLUE}>RESULT</text>
					<text>{resultBlock(detail, status)}</text>
					<text fg={MUTED}>Transcript tail hidden for completed tasks; attach/open transcript for raw logs.</text>
				</>
			) : (
				<>
					<text fg={BLUE}>{`LIVE OUTPUT (${lines.length} line${lines.length === 1 ? "" : "s"})`}</text>
					<scrollbox flexGrow={1} stickyScroll stickyStart="bottom" viewportCulling>
						<text>{
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
