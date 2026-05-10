import type { TaskStatusView } from "@cuekit/core";
import type { TuiExit } from "./tui-state.ts";

const ATTACH_HINT_RE = /^tmux\s+attach(?:-session)?\s+-t\s+([^\s]+)$/;

/**
 * Resolve the structured attach instruction for a task. Prefers the new
 * `attach_command` field; falls back to legacy `metadata.tmux_session_name`
 * + `attach_hint` parsing during the deprecation window. Returns null when
 * the task is not attachable (terminal, or batch-mode).
 */
export function getPaneAttachCommand(view: TaskStatusView): { argv: string[] } | null {
	if (view.attach_command) return view.attach_command;
	// Legacy fallback paths — both eventually become tmux attach-session argv.
	const metadataSession =
		view.metadata?.pane_session_name ?? view.metadata?.tmux_session_name;
	if (typeof metadataSession === "string" && metadataSession.length > 0) {
		return { argv: ["tmux", "attach-session", "-t", metadataSession] };
	}
	if (!view.attach_hint) return null;
	const match = ATTACH_HINT_RE.exec(view.attach_hint.trim());
	if (!match?.[1]) return null;
	return { argv: ["tmux", "attach-session", "-t", match[1]] };
}

/**
 * Backwards-compatible helper retained for callers that still want a bare
 * tmux session name. New code should consume `getPaneAttachCommand`.
 *
 * Removal is filed as part of Phase 5 cleanup (#422 / #423).
 */
export function getTmuxSessionName(view: TaskStatusView): string | null {
	const command = getPaneAttachCommand(view);
	if (!command) return null;
	// tmux attach forms put the session name as the last argv element
	// (`tmux attach-session -t <name>`). Zellij's attach form is the same
	// shape (`zellij attach <name>`) so this works for both.
	return command.argv[command.argv.length - 1] ?? null;
}

/**
 * Tmux-specific argv builder retained for the existing call sites that prepend
 * `set-option -t <session> mouse on` before attach. When the TUI starts using
 * a zellij backend (Phase 3), team-aware backends should return their own
 * full argv via `attach_command` and this helper falls out of use.
 */
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
