import type { TaskSummary } from "@cuekit/core";
import type { ReactNode } from "react";
import type { TuiTaskDetail } from "../data.ts";

function eventLine(event: TuiTaskDetail["events"][number]): string {
	const message = event.message ? ` ${event.message}` : "";
	return `#${event.sequence} ${event.type}${message}`;
}

export function TaskDetail(props: { task?: TaskSummary; detail?: TuiTaskDetail }): ReactNode {
	const { task, detail } = props;
	if (!task) {
		return (
			<box title="Detail" borderStyle="rounded" flexGrow={2} padding={1}>
				<text fg="#888888">Select a task.</text>
			</box>
		);
	}

	const status = detail?.status;
	return (
		<box title="Detail" borderStyle="rounded" flexGrow={2} padding={1} flexDirection="column">
			<text fg="#bb9af7">{`Task: ${task.task_id}`}</text>
			<text>{`Agent: ${task.agent_kind}`}</text>
			<text>{`Status: ${status?.status ?? task.status}`}</text>
			{status?.attach_hint ? <text>{`Attach: ${status.attach_hint}`}</text> : null}
			{status?.summary ? <text>{`Summary: ${status.summary}`}</text> : null}
			{detail?.transcriptPath ? <text>{`Transcript: ${detail.transcriptPath}`}</text> : null}
			<text fg="#7dcfff">Events</text>
			{detail && detail.events.length > 0 ? (
				detail.events.slice(-8).map((event) => <text key={event.id}>{eventLine(event)}</text>)
			) : (
				<text fg="#888888">No events.</text>
			)}
			<text fg="#7dcfff">Transcript tail</text>
			{detail && detail.transcriptTail.length > 0 ? (
				detail.transcriptTail.slice(-12).map((line, index) => <text key={`${index}:${line}`}>{line}</text>)
			) : (
				<text fg="#888888">No transcript available yet.</text>
			)}
		</box>
	);
}
