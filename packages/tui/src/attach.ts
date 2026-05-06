import type { TaskStatusView } from "@cuekit/core";
import type { TuiExit } from "./tui-state.ts";

const ATTACH_HINT_RE = /^tmux\s+attach(?:-session)?\s+-t\s+([^\s]+)$/;

export function getTmuxSessionName(view: TaskStatusView): string | null {
	const metadataSession = view.metadata?.tmux_session_name;
	if (typeof metadataSession === "string" && metadataSession.length > 0) return metadataSession;
	if (!view.attach_hint) return null;
	const match = ATTACH_HINT_RE.exec(view.attach_hint.trim());
	return match?.[1] ?? null;
}

export function buildTmuxAttachArgs(sessionName: string): string[] {
	return [
		"tmux",
		"set-option",
		"-t",
		sessionName,
		"mouse",
		"on",
		";",
		"attach-session",
		"-t",
		sessionName,
	];
}

export function buildTuiTaskAttachExit(sessionName: string, taskId: string): TuiExit {
	return {
		kind: "attach",
		args: buildTmuxAttachArgs(sessionName),
		returnState: { mode: "tasks", selected_task_id: taskId },
	};
}

export function buildTuiTeamMemberAttachExit(
	sessionName: string,
	teamId: string,
	taskId: string,
): TuiExit {
	return {
		kind: "attach",
		args: buildTmuxAttachArgs(sessionName),
		returnState: {
			mode: "teams",
			selected_team_id: teamId,
			selected_member_task_id: taskId,
			team_focus: "members",
		},
	};
}

export async function runAttachArgs(args: string[]): Promise<number> {
	const proc = Bun.spawn(args, {
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	});
	return proc.exited;
}

export async function runTmuxAttach(sessionName: string): Promise<number> {
	return runAttachArgs(buildTmuxAttachArgs(sessionName));
}
