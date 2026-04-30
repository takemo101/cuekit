import type { TaskSummary } from "@cuekit/core";
import type { ReactNode } from "react";

const TASK_LIST_WIDTH = 48;
const TASK_ROW_WIDTH = 44;

function truncateEnd(value: string, maxLength: number): string {
	if (value.length <= maxLength) return value;
	return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function taskRow(task: TaskSummary, selected: boolean): string {
	const prefix = selected ? "›" : " ";
	const identity = `${task.task_id} / ${task.status} / ${task.agent_kind}`;
	const summary = task.summary ? ` — ${truncateEnd(task.summary, 24)}` : "";
	return truncateEnd(`${prefix} ${identity}${summary}`, TASK_ROW_WIDTH);
}

export function TaskList(props: { tasks: TaskSummary[]; selectedIndex: number }): ReactNode {
	const { tasks, selectedIndex } = props;
	return (
		<box title="Tasks" borderStyle="rounded" width={TASK_LIST_WIDTH} flexShrink={0} padding={1}>
			{tasks.length === 0 ? (
				<text fg="#888888">No tasks found.</text>
			) : (
				tasks.map((task, index) => {
					const selected = index === selectedIndex;
					return (
						<text key={task.task_id} fg={selected ? "#7aa2f7" : "#c0caf5"}>
							{taskRow(task, selected)}
						</text>
					);
				})
			)}
		</box>
	);
}
