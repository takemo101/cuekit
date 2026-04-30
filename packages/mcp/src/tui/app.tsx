import { useKeyboard, useRenderer } from "@opentui/react";
import type { TaskSummary } from "@cuekit/core";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { CommandContext } from "../command-context.ts";
import { loadTaskDetail, loadTaskList, type TuiTaskDetail } from "./data.ts";
import { moveSelection } from "./task-actions.ts";
import { Footer } from "./components/footer.tsx";
import { TaskDetail } from "./components/task-detail.tsx";
import { TaskList } from "./components/task-list.tsx";

export function App(props: { ctx: CommandContext }): ReactNode {
	const renderer = useRenderer();
	const [tasks, setTasks] = useState<TaskSummary[]>([]);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [detail, setDetail] = useState<TuiTaskDetail | undefined>();
	const [loading, setLoading] = useState(false);
	const [message, setMessage] = useState<string | undefined>();
	const [error, setError] = useState<string | undefined>();

	const selectedTask = useMemo(() => tasks[selectedIndex], [tasks, selectedIndex]);

	const refresh = useCallback(async () => {
		setLoading(true);
		setError(undefined);
		try {
			const list = await loadTaskList(props.ctx, { limit: 100 });
			if ("error" in list) {
				setError(list.error.message);
				setTasks([]);
				setDetail(undefined);
				return;
			}
			setTasks(list.tasks);
			setSelectedIndex((current) => moveSelection(current, 0, list.tasks.length));
			setMessage(`Loaded ${list.tasks.length} task(s)`);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}, [props.ctx]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	useEffect(() => {
		setDetail(undefined);
		if (!selectedTask) {
			return;
		}
		let cancelled = false;
		void (async () => {
			try {
				const loaded = await loadTaskDetail(props.ctx, selectedTask.task_id);
				if (!cancelled) setDetail(loaded);
			} catch (err) {
				if (!cancelled) setError(err instanceof Error ? err.message : String(err));
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [props.ctx, selectedTask]);

	useKeyboard((key) => {
		if (key.name === "q" || key.name === "escape") {
			renderer.destroy();
			return;
		}
		if (key.name === "up" || key.name === "k") {
			setSelectedIndex((current) => moveSelection(current, -1, tasks.length));
			return;
		}
		if (key.name === "down" || key.name === "j") {
			setSelectedIndex((current) => moveSelection(current, 1, tasks.length));
			return;
		}
		if (key.name === "r") {
			void refresh();
			return;
		}
		if (["a", "s", "c", "d"].includes(key.name)) {
			setMessage(`Action '${key.name}' will be implemented in a follow-up issue.`);
		}
	});

	return (
		<box width="100%" height="100%" flexDirection="column">
			<box flexDirection="row" flexGrow={1} gap={1}>
				<TaskList tasks={tasks} selectedIndex={selectedIndex} />
				<TaskDetail task={selectedTask} detail={detail} />
			</box>
			<Footer message={message} error={error} loading={loading} />
		</box>
	);
}
