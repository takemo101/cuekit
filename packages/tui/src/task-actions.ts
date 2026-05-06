import {
	isTerminalTaskStatus,
	type TaskStatus,
	type TaskStatusView,
	type TeamTaskCounts,
} from "@cuekit/core";

export type TeamFocus = "list" | "members";

export function moveSelection(index: number, delta: number, length: number): number {
	if (length <= 0) return 0;
	return Math.max(0, Math.min(length - 1, index + delta));
}

export function listWindow(input: { length: number; selectedIndex: number; maxVisible: number }): {
	start: number;
	end: number;
} {
	const { length } = input;
	const maxVisible = Math.max(0, input.maxVisible);
	if (length <= 0 || maxVisible <= 0) return { start: 0, end: 0 };
	if (length <= maxVisible) return { start: 0, end: length };
	const selectedIndex = Math.max(0, Math.min(length - 1, input.selectedIndex));
	const half = Math.floor(maxVisible / 2);
	const start = Math.max(0, Math.min(length - maxVisible, selectedIndex - half));
	return { start, end: start + maxVisible };
}

export function restoreIndexById<T>(
	items: T[],
	id: string | undefined,
	fallbackIndex: number,
	getId: (item: T) => string,
): number {
	if (items.length <= 0) return 0;
	if (id) {
		const found = items.findIndex((item) => getId(item) === id);
		if (found >= 0) return found;
	}
	return Math.max(0, Math.min(items.length - 1, fallbackIndex));
}

export function resolveEnterTeamFocus(focus: TeamFocus, memberCount: number): TeamFocus {
	if (focus === "list" && memberCount > 0) return "members";
	return focus;
}

export function resolveEscapeTeamFocus(focus: TeamFocus): TeamFocus {
	return focus === "members" ? "list" : "list";
}

function hasTmuxSessionMetadata(view: TaskStatusView): boolean {
	return (
		typeof view.metadata?.tmux_session_name === "string" &&
		view.metadata.tmux_session_name.length > 0
	);
}

export function canAttach(view: TaskStatusView): boolean {
	if (view.supports_attach !== true) return false;
	if (view.status === "cancelled" || view.status === "timed_out") return false;
	if (isTerminalTaskStatus(view.status)) return hasTmuxSessionMetadata(view);
	return Boolean(view.attach_hint) || hasTmuxSessionMetadata(view);
}

export function canCancel(status: TaskStatus): boolean {
	return !isTerminalTaskStatus(status);
}

export function canDelete(status: TaskStatus): boolean {
	return isTerminalTaskStatus(status);
}

export function canCleanupTeam(counts: TeamTaskCounts | undefined): boolean {
	if (!counts) return false;
	return (
		counts.completed + counts.failed + counts.cancelled + counts.timed_out + counts.blocked > 0
	);
}

export function canDeleteTeam(counts: TeamTaskCounts | undefined): boolean {
	return counts?.total === 0;
}
