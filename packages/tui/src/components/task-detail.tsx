import type { TaskStatus, TaskSummary } from "@cuekit/core";
import type { ReactNode } from "react";
import type { TuiTaskEvent } from "../context.ts";
import type { TuiTaskDetail } from "../data.ts";

const MUTED = "#565f89";
const TEXT_MUTED = "#a9b1d6";
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

function eventColor(type: string): string {
	if (type === "completed") return GREEN;
	if (type === "failed" || type === "blocked" || type === "timed_out") return RED;
	if (type === "cancelled") return YELLOW;
	return BLUE;
}

function formatUpdatedAt(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
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

function outputLines(detail: TuiTaskDetail | undefined, status: TaskStatus): string[] {
	const lines = detail?.transcriptTail ?? [];
	if (status === "completed") {
		const reportIndex = lines.findLastIndex((line) => line.includes("cuekit tool report"));
		if (reportIndex >= 0 && reportIndex < lines.length - 1) {
			return lines.slice(reportIndex + 1).filter((line) => !isReportBoilerplate(line)).slice(-12);
		}
	}
	return lines.filter((line) => !isReportBoilerplate(line)).slice(-16);
}

function eventLine(event: TuiTaskEvent): string {
	const sequence = `#${event.sequence}`.padEnd(6);
	const type = event.type.padEnd(12);
	const message = event.message ?? "";
	return truncateEnd(`${sequence}${type}${message}`, 128);
}

function SectionTitle(props: { title: string; aside?: string }): ReactNode {
	return (
		<box flexDirection="row" justifyContent="space-between">
			<text fg={BLUE}>{props.title}</text>
			{props.aside ? <text fg={MUTED}>{props.aside}</text> : null}
		</box>
	);
}

function MetadataLine(props: { label: string; value: string; muted?: boolean }): ReactNode {
	return (
		<text fg={props.muted ? MUTED : TEXT_MUTED}>{`${props.label.padEnd(11)} ${props.value}`}</text>
	);
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
	const lines = outputLines(detail, status);
	const outputTitle = status === "completed" ? "OUTPUT" : "LIVE OUTPUT";

	return (
		<box borderStyle="rounded" flexGrow={2} padding={1} flexDirection="column">
			<box flexDirection="row" justifyContent="space-between">
				<text fg={PURPLE}>{`${task.task_id}  ${task.agent_kind}`}</text>
				<text fg={statusColor(status)}>{status}</text>
			</box>
			<text fg={MUTED}>{`updated ${formatUpdatedAt(task.updated_at)}`}</text>
			<text> </text>

			<MetadataLine label="transcript" value={pathLabel(detail?.transcriptPath)} muted={!detail?.transcriptPath} />
			{detail?.status.attach_hint ? (
				<MetadataLine label="attach" value={truncateMiddle(detail.status.attach_hint, 96)} />
			) : null}
			{detail?.status.summary ? (
				<MetadataLine label="summary" value={truncateEnd(detail.status.summary, 110)} />
			) : null}
			<text> </text>

			<SectionTitle title="EVENTS" aside={events.length > 0 ? `${events.length} shown` : undefined} />
			{events.length > 0 ? (
				events.map((event) => (
					<text key={event.id} fg={eventColor(event.type)}>{`  ${eventLine(event)}`}</text>
				))
			) : (
				<EmptyText>  No events yet.</EmptyText>
			)}
			<text> </text>

			<SectionTitle title={outputTitle} aside={`${lines.length} line(s)`} />
			<scrollbox flexGrow={1} stickyScroll stickyStart="bottom" viewportCulling>
				{lines.length > 0 ? (
					lines.map((line, index) => (
						<text key={`${index}:${line}`}>{truncateEnd(line, 150)}</text>
					))
				) : (
					<EmptyText>No output available yet.</EmptyText>
				)}
			</scrollbox>
		</box>
	);
}
