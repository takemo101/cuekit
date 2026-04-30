import { useKeyboard, useRenderer } from "@opentui/react";
import type { TaskSummary } from "@cuekit/core";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { CommandContext } from "../command-context.ts";
import { runCancelTask } from "../commands/cancel-task.ts";
import { runDeleteTask } from "../commands/delete-task.ts";
import { runSteerTask } from "../commands/steer-task.ts";
import { buildTmuxAttachArgs, getTmuxSessionName } from "./attach.ts";
import { ConfirmDialog } from "./components/confirm-dialog.tsx";
import { Footer } from "./components/footer.tsx";
import { InputDialog } from "./components/input-dialog.tsx";
import { TaskDetail } from "./components/task-detail.tsx";
import { TaskList } from "./components/task-list.tsx";
import { loadTaskDetail, loadTaskList, type TuiTaskDetail } from "./data.ts";
import { canAttach, canCancel, canDelete, moveSelection } from "./task-actions.ts";

type PendingConfirm = { kind: "cancel" | "delete"; taskId: string } | null;
type SteerInputState = { taskId: string; value: string } | null;

export function App(props: { ctx: CommandContext; onAttach?: (args: string[]) => void }): ReactNode {
	const renderer = useRenderer();
	const [tasks, setTasks] = useState<TaskSummary[]>([]);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [detail, setDetail] = useState<TuiTaskDetail | undefined>();
	const [loading, setLoading] = useState(false);
	const [message, setMessage] = useState<string | undefined>();
	const [error, setError] = useState<string | undefined>();
	const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm>(null);
	const [steerInput, setSteerInput] = useState<SteerInputState>(null);

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

	const executeConfirm = useCallback(async () => {
		if (!pendingConfirm) return;
		const action = pendingConfirm;
		setPendingConfirm(null);
		setLoading(true);
		setError(undefined);
		try {
			const result =
				action.kind === "cancel"
					? await runCancelTask(props.ctx, { task_id: action.taskId })
					: await runDeleteTask(props.ctx, { task_id: action.taskId });
			if (!result.ok) {
				setError(result.error.message);
				return;
			}
			setMessage(result.message ?? `${action.kind} completed`);
			await refresh();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}, [pendingConfirm, props.ctx, refresh]);

	const submitSteer = useCallback(
		async (state: SteerInputState) => {
			if (!state) return;
			const { taskId, value } = state;
			const text = value.trim();
			setSteerInput(null);
			if (!text) {
				setMessage("Steer cancelled.");
				return;
			}
			setLoading(true);
			setError(undefined);
			try {
				const result = await runSteerTask(props.ctx, { task_id: taskId, message: text });
				if (!result.ok) {
					setError(result.error.message);
					return;
				}
				setMessage(result.message ?? "Steering message delivered.");
				await refresh();
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err));
			} finally {
				setLoading(false);
			}
		},
		[props.ctx, refresh],
	);

	useKeyboard((key) => {
		if (steerInput !== null) {
			if (key.name === "escape") {
				setSteerInput(null);
				setMessage("Steer cancelled.");
				return;
			}
			if (key.name === "return") {
				void submitSteer(steerInput);
				return;
			}
			if (key.name === "backspace") {
				setSteerInput((current) =>
					current ? { ...current, value: current.value.slice(0, -1) } : current,
				);
				return;
			}
			if (key.sequence.length === 1 && !key.ctrl && !key.meta) {
				setSteerInput((current) =>
					current ? { ...current, value: `${current.value}${key.sequence}` } : current,
				);
			}
			return;
		}
		if (pendingConfirm) {
			if (key.name === "y") {
				void executeConfirm();
				return;
			}
			if (key.name === "n" || key.name === "escape") {
				setPendingConfirm(null);
				setMessage("Action cancelled.");
			}
			return;
		}
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
		if (key.name === "a") {
			if (!detail || !canAttach(detail.status)) {
				setError("Selected task is not attachable.");
				return;
			}
			const sessionName = getTmuxSessionName(detail.status);
			if (!sessionName) {
				setError("Selected task does not expose a tmux session name.");
				return;
			}
			props.onAttach?.(buildTmuxAttachArgs(sessionName));
			renderer.destroy();
			return;
		}
		if (key.name === "c") {
			if (!selectedTask || !canCancel(selectedTask.status)) {
				setError("Selected task cannot be cancelled.");
				return;
			}
			setPendingConfirm({ kind: "cancel", taskId: selectedTask.task_id });
			return;
		}
		if (key.name === "d") {
			if (!selectedTask || !canDelete(selectedTask.status)) {
				setError("Selected task cannot be deleted until it is terminal.");
				return;
			}
			setPendingConfirm({ kind: "delete", taskId: selectedTask.task_id });
			return;
		}
		if (key.name === "s") {
			if (!selectedTask) {
				setError("No selected task to steer.");
				return;
			}
			setSteerInput({ taskId: selectedTask.task_id, value: "" });
		}
	});

	return (
		<box width="100%" height="100%" flexDirection="column">
			<box flexDirection="row" flexGrow={1} gap={1}>
				<TaskList tasks={tasks} selectedIndex={selectedIndex} />
				<TaskDetail task={selectedTask} detail={detail} />
			</box>
			{pendingConfirm ? (
				<ConfirmDialog
					title={`${pendingConfirm.kind === "cancel" ? "Cancel" : "Delete"} task`}
					message={`${pendingConfirm.kind} ${pendingConfirm.taskId}?`}
				/>
			) : null}
			{steerInput !== null ? (
				<InputDialog title={`Steer ${steerInput.taskId}`} value={steerInput.value} />
			) : null}
			<Footer message={message} error={error} loading={loading} />
		</box>
	);
}
