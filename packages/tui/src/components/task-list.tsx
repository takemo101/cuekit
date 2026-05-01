import type { TaskSummary } from "@cuekit/core";
import type { ReactNode } from "react";
import { statusAccent, statusGlyph, theme } from "../theme.ts";

const TASK_LIST_WIDTH = 42;
const TASK_ROW_WIDTH = 38;

function truncateEnd(value: string, maxLength: number): string {
	if (value.length <= maxLength) return value;
	return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function compactStatus(status: string): string {
	if (status === "input_required") return "input";
	if (status === "timed_out") return "timeout";
	return status;
}

function taskRow(task: TaskSummary, selected: boolean): string {
	const marker = selected ? "›" : " ";
	const glyph = statusGlyph(task.status);
	const id = task.task_id.padEnd(12).slice(0, 12);
	const agent = task.agent_kind.padEnd(8).slice(0, 8);
	const status = compactStatus(task.status).padEnd(8).slice(0, 8);
	return truncateEnd(`${marker} ${glyph} ${id} ${agent} ${status}`, TASK_ROW_WIDTH);
}

function rowBackground(index: number, selected: boolean): string {
	if (selected) return theme.rowSelected;
	return index % 2 === 0 ? theme.rowAlt : theme.row;
}

export function TaskList(props: { tasks: TaskSummary[]; selectedIndex: number }): ReactNode {
	const { tasks, selectedIndex } = props;
	return (
		<box
			title="Tasks"
			borderStyle="single"
			borderColor={theme.border}
			backgroundColor={theme.panel}
			width={TASK_LIST_WIDTH}
			flexShrink={0}
			padding={1}
		>
			<box backgroundColor={theme.panelAlt} height={1}>
				<text fg={theme.muted}>{"  ST TASK_ID      AGENT    STATUS"}</text>
			</box>
			{tasks.length === 0 ? (
				<text fg={theme.muted}>No tasks found.</text>
			) : (
				tasks.map((task, index) => {
					const selected = index === selectedIndex;
					return (
						<box key={task.task_id} backgroundColor={rowBackground(index, selected)} height={1}>
							<text fg={selected ? theme.strong : statusAccent(task.status)}>{taskRow(task, selected)}</text>
						</box>
					);
				})
			)}
		</box>
	);
}
