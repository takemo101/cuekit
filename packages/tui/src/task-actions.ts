import { isTerminalTaskStatus, type TaskStatus, type TaskStatusView } from "@cuekit/core";

export function moveSelection(index: number, delta: number, length: number): number {
	if (length <= 0) return 0;
	return Math.max(0, Math.min(length - 1, index + delta));
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
