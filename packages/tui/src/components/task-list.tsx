import type { TaskSummary } from "@cuekit/core";
import type { ReactNode } from "react";
import { truncateEnd } from "../format.ts";
import { statusAccent, statusGlyph, theme } from "../theme.ts";

const TASK_LIST_WIDTH = 42;
const TASK_ROW_WIDTH = 38;

function compactStatus(status: string): string {
	if (status === "input_required") return "input";
	if (status === "timed_out") return "timeout";
	return status;
}

function teamTag(task: TaskSummary): string {
	if (!task.team_id) return "-";
	const position = task.position ? task.position.slice(0, 1) : "t";
	return `${position}@${task.team_id.slice(-4)}`;
}

export function taskRow(task: TaskSummary, selected: boolean): string {
	const marker = selected ? "›" : " ";
	const glyph = statusGlyph(task.status);
	const id = task.task_id.padEnd(10).slice(0, 10);
	const agent = task.agent_kind.padEnd(6).slice(0, 6);
	const status = compactStatus(task.status).padEnd(7).slice(0, 7);
	const team = teamTag(task).padEnd(6).slice(0, 6);
	return truncateEnd(`${marker} ${glyph} ${id} ${agent} ${status} ${team}`, TASK_ROW_WIDTH);
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
				<text fg={theme.muted}>{"    TASK_ID    AGENT  STATUS  TEAM"}</text>
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
