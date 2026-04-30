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

function taskTitle(task: TaskSummary, status: TaskStatus): string {
	return `${task.task_id}   ${task.agent_kind}   ${status}`;
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
	const outputTitle = status === "completed" ? "Output" : "Live output";

	return (
		<box borderStyle="rounded" flexGrow={2} padding={1} flexDirection="column" gap={1}>
			<box flexDirection="row" justifyContent="space-between">
				<text fg={PURPLE}>{taskTitle(task, status)}</text>
				<text fg={MUTED}>{`updated ${formatUpdatedAt(task.updated_at)}`}</text>
			</box>

			<box flexDirection="column">
				<box flexDirection="row">
					<text fg={MUTED}>transcript  </text>
					<text fg={detail?.transcriptPath ? TEXT_MUTED : MUTED}>{pathLabel(detail?.transcriptPath)}</text>
				</box>
				{detail?.status.attach_hint ? (
					<box flexDirection="row">
						<text fg={MUTED}>attach      </text>
						<text fg={TEXT_MUTED}>{truncateMiddle(detail.status.attach_hint, 96)}</text>
					</box>
				) : null}
				{detail?.status.summary ? (
					<box flexDirection="row">
						<text fg={MUTED}>summary     </text>
						<text fg={TEXT_MUTED}>{truncateEnd(detail.status.summary, 110)}</text>
					</box>
				) : null}
			</box>

			<box borderStyle="single" padding={1} flexDirection="column" gap={1}>
				<box flexDirection="row" justifyContent="space-between">
					<text fg={BLUE}>Events</text>
					<text fg={MUTED}>{`${events.length} shown`}</text>
				</box>
				{events.length > 0 ? (
					events.map((event) => (
						<text key={event.id} fg={eventColor(event.type)}>{eventLine(event)}</text>
					))
				) : (
					<EmptyText>No events yet.</EmptyText>
				)}
			</box>

			<box borderStyle="single" paddingX={1} paddingY={0} flexDirection="column" flexGrow={1}>
				<box flexDirection="row" justifyContent="space-between">
					<text fg={BLUE}>{outputTitle}</text>
					<text fg={MUTED}>{`${lines.length} line(s)`}</text>
				</box>
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
		</box>
	);
}
