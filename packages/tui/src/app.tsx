import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import type { TaskSummary, TeamSummary } from "@cuekit/core";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { TuiContext } from "./context.ts";
import {
	buildTuiTaskAttachExit,
	buildTuiTeamMemberAttachExit,
	getTmuxSessionName,
} from "./attach.ts";
import { ConfirmDialog } from "./components/confirm-dialog.tsx";
import { Footer } from "./components/footer.tsx";
import { InputDialog } from "./components/input-dialog.tsx";
import { TaskDetail } from "./components/task-detail.tsx";
import { TaskList } from "./components/task-list.tsx";
import { TeamDetail } from "./components/team-detail.tsx";
import { TeamList } from "./components/team-list.tsx";
import {
	loadTaskDetail,
	loadTaskList,
	loadTeamDetail,
	loadTeamList,
	type TuiTaskDetail,
	type TuiTeamDetail,
} from "./data.ts";
import {
	canAttach,
	canCancel,
	canCleanupTeam,
	canDelete,
	canDeleteTeam,
	moveSelection,
	resolveEnterTeamFocus,
	resolveEscapeTeamFocus,
	restoreIndexById,
} from "./task-actions.ts";
import { theme } from "./theme.ts";
import type { TeamFocus, TuiExit, TuiMode, TuiReturnState } from "./tui-state.ts";

const AUTO_REFRESH_MS = 3000;

type PendingConfirmAction =
	| { kind: "cancel"; taskId: string }
	| { kind: "delete"; taskId: string }
	| { kind: "cleanup-team"; teamId: string }
	| { kind: "delete-team"; teamId: string };
type PendingConfirm = PendingConfirmAction | null;
type SteerInputState = { taskId: string; value: string } | null;

function confirmTitle(action: PendingConfirmAction): string {
	if (action.kind === "cleanup-team") return "Cleanup team";
	if (action.kind === "delete-team") return "Delete team";
	return `${action.kind === "cancel" ? "Cancel" : "Delete"} task`;
}

function confirmMessage(action: PendingConfirmAction): string {
	if (action.kind === "cleanup-team") return `Cleanup terminal tasks in ${action.teamId}?`;
	if (action.kind === "delete-team") return `Delete empty team ${action.teamId}?`;
	return `${action.kind} ${action.taskId}?`;
}

export function App(props: {
	ctx: TuiContext;
	initialState?: TuiReturnState;
	onExit: (exit: TuiExit) => void;
}): ReactNode {
	const renderer = useRenderer();
	const terminal = useTerminalDimensions();
	const initialState = useRef(props.initialState);
	const [mode, setMode] = useState<TuiMode>(props.initialState?.mode ?? "tasks");
	const [tasks, setTasks] = useState<TaskSummary[]>([]);
	const [teams, setTeams] = useState<TeamSummary[]>([]);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [selectedTeamIndex, setSelectedTeamIndex] = useState(0);
	const [selectedMemberIndex, setSelectedMemberIndex] = useState(0);
	const [teamFocus, setTeamFocus] = useState<TeamFocus>(props.initialState?.team_focus ?? "list");
	const [detail, setDetail] = useState<TuiTaskDetail | undefined>();
	const [teamDetail, setTeamDetail] = useState<TuiTeamDetail | undefined>();
	const [loading, setLoading] = useState(false);
	const [message, setMessage] = useState<string | undefined>();
	const [error, setError] = useState<string | undefined>();
	const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm>(null);
	const [steerInput, setSteerInput] = useState<SteerInputState>(null);
	const refreshInFlight = useRef(false);

	const selectedTask = useMemo(() => tasks[selectedIndex], [tasks, selectedIndex]);
	const selectedTeam = useMemo(() => teams[selectedTeamIndex], [teams, selectedTeamIndex]);
	const selectedMember = useMemo(
		() => teamDetail?.members[selectedMemberIndex],
		[teamDetail, selectedMemberIndex],
	);
	const selectedTeamCounts = selectedTeam?.task_counts ?? teamDetail?.status?.task_counts;
	const listRows = Math.max(1, terminal.height - 7);

	const exit = useCallback(
		(next: TuiExit) => {
			props.onExit(next);
			renderer.destroy();
		},
		[props, renderer],
	);

	const refreshTasks = useCallback(async () => {
		const list = await loadTaskList(props.ctx, { limit: 100 });
		if ("error" in list) {
			setError(list.error.message);
			setTasks([]);
			setDetail(undefined);
			return;
		}
		setTasks(list.tasks);
		setSelectedIndex((current) => {
			const requested = initialState.current?.selected_task_id;
			initialState.current = { ...initialState.current, selected_task_id: undefined };
			return restoreIndexById(list.tasks, requested, current, (task) => task.task_id);
		});
		setMessage(`Loaded ${list.tasks.length} task(s)`);
	}, [props.ctx]);

	const refreshTeams = useCallback(async () => {
		const list = await loadTeamList(props.ctx, { limit: 100 });
		if ("error" in list) {
			setError(list.error.message);
			setTeams([]);
			setTeamDetail(undefined);
			return;
		}
		setTeams(list.teams);
		setSelectedTeamIndex((current) =>
			restoreIndexById(
				list.teams,
				initialState.current?.selected_team_id,
				current,
				(team) => team.team_id,
			),
		);
		setMessage(`Loaded ${list.teams.length} team(s)`);
	}, [props.ctx]);

	const refresh = useCallback(async () => {
		if (refreshInFlight.current) return;
		refreshInFlight.current = true;
		setLoading(true);
		setError(undefined);
		try {
			if (mode === "teams") await refreshTeams();
			else await refreshTasks();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			refreshInFlight.current = false;
			setLoading(false);
		}
	}, [mode, refreshTasks, refreshTeams]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	useEffect(() => {
		if (pendingConfirm !== null || steerInput !== null) return;
		const timer = setInterval(() => {
			void refresh();
		}, AUTO_REFRESH_MS);
		return () => clearInterval(timer);
	}, [pendingConfirm, refresh, steerInput]);

	useEffect(() => {
		setDetail(undefined);
		if (mode !== "tasks" || !selectedTask) return;
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
	}, [mode, props.ctx, selectedTask]);

	useEffect(() => {
		setTeamDetail(undefined);
		if (mode !== "teams" || !selectedTeam) return;
		let cancelled = false;
		void (async () => {
			try {
				const loaded = await loadTeamDetail(props.ctx, selectedTeam);
				if (cancelled) return;
				setTeamDetail(loaded);
				setSelectedMemberIndex((current) => {
					const restored = restoreIndexById(
						loaded.members,
						initialState.current?.selected_member_task_id,
						current,
						(member) => member.task_id,
					);
					initialState.current = {
						...initialState.current,
						selected_team_id: undefined,
						selected_member_task_id: undefined,
					};
					if (loaded.members.length === 0) setTeamFocus("list");
					return restored;
				});
			} catch (err) {
				if (!cancelled) setError(err instanceof Error ? err.message : String(err));
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [mode, props.ctx, selectedTeam]);

	const executeConfirm = useCallback(async () => {
		if (!pendingConfirm) return;
		const action = pendingConfirm;
		setPendingConfirm(null);
		setLoading(true);
		setError(undefined);
		try {
			const result =
				action.kind === "cancel"
					? await props.ctx.cancelTask(action.taskId)
					: action.kind === "delete"
						? await props.ctx.deleteTask(action.taskId)
						: action.kind === "cleanup-team"
							? await props.ctx.cleanupTeam?.(action.teamId)
							: await props.ctx.deleteTeam?.(action.teamId);
			if (!result) {
				setError("Selected team action is not available.");
				return;
			}
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
				const result = await props.ctx.steerTask(taskId, text);
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

	const attachSelectedMember = useCallback(async () => {
		if (!selectedTeam || !selectedMember) {
			setError("Select a team member to attach.");
			return;
		}
		try {
			const memberStatus = await props.ctx.getTaskStatus(selectedMember.task_id);
			if (!canAttach(memberStatus)) {
				setError("Selected team member is not attachable.");
				return;
			}
			const sessionName = getTmuxSessionName(memberStatus);
			if (!sessionName) {
				setError("Selected team member does not expose a tmux session name.");
				return;
			}
			exit(buildTuiTeamMemberAttachExit(sessionName, selectedTeam.team_id, selectedMember.task_id));
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}, [exit, props.ctx, selectedMember, selectedTeam]);

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
		if (key.name === "q") {
			exit({ kind: "quit" });
			return;
		}
		if (key.name === "escape") {
			const nextFocus = resolveEscapeTeamFocus(teamFocus);
			if (mode === "teams" && nextFocus !== teamFocus) {
				setTeamFocus(nextFocus);
				return;
			}
			exit({ kind: "quit" });
			return;
		}
		if (key.name === "t") {
			setMode((current) => (current === "tasks" ? "teams" : "tasks"));
			setTeamFocus("list");
			return;
		}
		if (key.name === "up" || key.name === "k") {
			if (mode === "teams") {
				if (teamFocus === "members") setSelectedMemberIndex((current) => moveSelection(current, -1, teamDetail?.members.length ?? 0));
				else setSelectedTeamIndex((current) => moveSelection(current, -1, teams.length));
			} else {
				setSelectedIndex((current) => moveSelection(current, -1, tasks.length));
			}
			return;
		}
		if (key.name === "down" || key.name === "j") {
			if (mode === "teams") {
				if (teamFocus === "members") setSelectedMemberIndex((current) => moveSelection(current, 1, teamDetail?.members.length ?? 0));
				else setSelectedTeamIndex((current) => moveSelection(current, 1, teams.length));
			} else {
				setSelectedIndex((current) => moveSelection(current, 1, tasks.length));
			}
			return;
		}
		if (key.name === "return" && mode === "teams") {
			setTeamFocus((current) => resolveEnterTeamFocus(current, teamDetail?.members.length ?? 0));
			return;
		}
		if (key.name === "r") {
			void refresh();
			return;
		}
		if (key.name === "a") {
			if (mode === "teams") {
				if (teamFocus !== "members") {
					setError("Press Enter to choose a team member before attaching.");
					return;
				}
				void attachSelectedMember();
				return;
			}
			if (!detail || !canAttach(detail.status)) {
				setError("Selected task is not attachable.");
				return;
			}
			const sessionName = getTmuxSessionName(detail.status);
			if (!sessionName) {
				setError("Selected task does not expose a tmux session name.");
				return;
			}
			exit(buildTuiTaskAttachExit(sessionName, detail.status.task_id));
			return;
		}
		if (key.name === "c") {
			if (mode === "teams") {
				if (!selectedTeam) {
					setError("Select a team to cleanup.");
					return;
				}
				if (!canCleanupTeam(selectedTeamCounts)) {
					setError("Selected team has no terminal tasks to cleanup.");
					return;
				}
				if (!props.ctx.cleanupTeam) {
					setError("Team cleanup is not available.");
					return;
				}
				setPendingConfirm({ kind: "cleanup-team", teamId: selectedTeam.team_id });
				return;
			}
			if (mode !== "tasks" || !selectedTask || !canCancel(selectedTask.status)) {
				setError("Selected task cannot be cancelled.");
				return;
			}
			setPendingConfirm({ kind: "cancel", taskId: selectedTask.task_id });
			return;
		}
		if (key.name === "d") {
			if (mode === "teams") {
				if (!selectedTeam) {
					setError("Select an empty team to delete.");
					return;
				}
				if (!canDeleteTeam(selectedTeamCounts)) {
					setError("Selected team must be empty before deletion.");
					return;
				}
				if (!props.ctx.deleteTeam) {
					setError("Team delete is not available.");
					return;
				}
				setPendingConfirm({ kind: "delete-team", teamId: selectedTeam.team_id });
				return;
			}
			if (mode !== "tasks" || !selectedTask || !canDelete(selectedTask.status)) {
				setError("Selected task cannot be deleted until it is terminal.");
				return;
			}
			setPendingConfirm({ kind: "delete", taskId: selectedTask.task_id });
			return;
		}
		if (key.name === "s") {
			if (mode !== "tasks" || !selectedTask) {
				setError("No selected task to steer.");
				return;
			}
			setSteerInput({ taskId: selectedTask.task_id, value: "" });
		}
	});

	const selectedAttachable = mode === "tasks" && detail ? canAttach(detail.status) : false;

	return (
		<box width="100%" height="100%" flexDirection="column" backgroundColor={theme.bg}>
			<box flexDirection="row" flexGrow={1} gap={1} backgroundColor={theme.bg}>
				{mode === "teams" ? (
					<>
						<TeamList teams={teams} selectedIndex={selectedTeamIndex} maxVisibleRows={listRows} />
						<TeamDetail team={selectedTeam} detail={teamDetail} selectedMemberIndex={selectedMemberIndex} focus={teamFocus} />
					</>
				) : (
					<>
						<TaskList tasks={tasks} selectedIndex={selectedIndex} maxVisibleRows={listRows} />
						<TaskDetail task={selectedTask} detail={detail} />
					</>
				)}
			</box>
			{pendingConfirm ? (
				<ConfirmDialog
					title={confirmTitle(pendingConfirm)}
					message={confirmMessage(pendingConfirm)}
				/>
			) : null}
			{steerInput !== null ? (
				<InputDialog title={`Steer ${steerInput.taskId}`} value={steerInput.value} />
			) : null}
			<Footer
				message={message}
				error={error}
				loading={loading}
				terminalWidth={terminal.width}
				attachable={selectedAttachable}
				mode={mode}
				teamFocus={teamFocus}
			/>
		</box>
	);
}
