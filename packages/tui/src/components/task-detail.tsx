import type { TaskSummary } from "@cuekit/core";
import type { ReactNode } from "react";
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

function eventLine(event: TuiTaskDetail["events"][number]): string {
	const message = event.message ? ` ${event.message}` : "";
	return truncateEnd(`#${event.sequence} ${event.type}${message}`, 120);
}

function statusColor(status: string): string {
	if (status === "completed") return GREEN;
	if (status === "failed" || status === "timed_out" || status === "blocked") return RED;
	if (status === "cancelled") return YELLOW;
	return BLUE;
}

function MetadataRow(props: { label: string; value: string; color?: string }): ReactNode {
	return (
		<box flexDirection="row">
			<text fg={MUTED}>{`${props.label.padEnd(11)} `}</text>
			<text fg={props.color}>{props.value}</text>
		</box>
	);
}

export function TaskDetail(props: { task?: TaskSummary; detail?: TuiTaskDetail }): ReactNode {
	const { task, detail } = props;
	if (!task) {
		return (
			<box borderStyle="rounded" flexGrow={2} padding={1}>
				<text fg={MUTED}>Select a task.</text>
			</box>
		);
	}

	const status = detail?.status;
	const effectiveStatus = status?.status ?? task.status;
	const transcriptPath = detail?.transcriptPath
		? truncateMiddle(detail.transcriptPath, 88)
		: "No transcript yet";
	const events = detail?.events.slice(-6) ?? [];
	const transcript = detail?.transcriptTail.slice(-18) ?? [];

	return (
		<box borderStyle="rounded" flexGrow={2} padding={1} flexDirection="column" gap={1}>
			<box flexDirection="row" justifyContent="space-between">
				<text fg={PURPLE}>{`Task detail: ${task.task_id}`}</text>
				<text fg={statusColor(effectiveStatus)}>{effectiveStatus}</text>
			</box>

			<box borderStyle="single" padding={1} flexDirection="column">
				<MetadataRow label="agent" value={task.agent_kind} />
				<MetadataRow label="updated" value={task.updated_at} color={MUTED} />
				{status?.attach_hint ? (
					<MetadataRow label="attach" value={truncateMiddle(status.attach_hint, 88)} />
				) : null}
				{status?.summary ? <MetadataRow label="summary" value={truncateEnd(status.summary, 100)} /> : null}
				<MetadataRow label="transcript" value={transcriptPath} color={detail?.transcriptPath ? undefined : MUTED} />
			</box>

			<box flexDirection="row" gap={1}>
				<box borderStyle="single" padding={1} flexDirection="column" flexGrow={1}>
					<text fg={BLUE}>Events</text>
					{events.length > 0 ? (
						events.map((event) => <text key={event.id}>{eventLine(event)}</text>)
					) : (
						<text fg={MUTED}>No events.</text>
					)}
				</box>
			</box>

			<box borderStyle="single" padding={1} flexDirection="column" flexGrow={1}>
				<box flexDirection="row" justifyContent="space-between">
					<text fg={BLUE}>Transcript tail</text>
					<text fg={MUTED}>{`${transcript.length} line(s)`}</text>
				</box>
				<scrollbox flexGrow={1} stickyScroll stickyStart="bottom" viewportCulling>
					{transcript.length > 0 ? (
						transcript.map((line, index) => (
							<text key={`${index}:${line}`}>{truncateEnd(line, 140)}</text>
						))
					) : (
						<text fg={MUTED}>No transcript available yet.</text>
					)}
				</scrollbox>
			</box>
		</box>
	);
}
