import type { TaskSummary } from "@cuekit/core";
import type { ReactNode } from "react";

export function TaskList(props: { tasks: TaskSummary[]; selectedIndex: number }): ReactNode {
	const { tasks, selectedIndex } = props;
	return (
		<box title="Tasks" borderStyle="rounded" flexGrow={1} flexShrink={0} padding={1}>
			{tasks.length === 0 ? (
				<text fg="#888888">No tasks found.</text>
			) : (
				tasks.map((task, index) => {
					const selected = index === selectedIndex;
					const prefix = selected ? "›" : " ";
					const summary = task.summary ? ` ${task.summary}` : "";
					return (
						<text key={task.task_id} fg={selected ? "#7aa2f7" : "#c0caf5"}>
							{`${prefix} ${task.task_id}  ${task.status.padEnd(12)}  ${task.agent_kind}${summary}`}
						</text>
					);
				})
			)}
		</box>
	);
}
