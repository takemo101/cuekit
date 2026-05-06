import { isTerminalTaskStatus, type TaskStatus, type TaskStatusView } from "@cuekit/core";

export type TeamFocus = "list" | "members";

export function moveSelection(index: number, delta: number, length: number): number {
	if (length <= 0) return 0;
	return Math.max(0, Math.min(length - 1, index + delta));
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
