import type { TaskStatusView } from "@cuekit/core";
import type { TuiExit } from "./tui-state.ts";

const TMUX_ATTACH_HINT_RE = /^tmux\s+attach(?:-session)?\s+-t\s+([^\s]+)$/;
const ZELLIJ_ATTACH_HINT_RE = /^zellij\s+attach\s+([^\s]+)$/;

/**
 * Resolve the structured attach instruction for a task. Prefers the new
 * `attach_command` field; falls back to legacy `metadata.tmux_session_name`
 * + `attach_hint` parsing during the deprecation window. Returns null when
 * the task is not attachable (terminal, or batch-mode).
 */
export function getPaneAttachCommand(view: TaskStatusView): { argv: string[] } | null {
	if (view.attach_command) return view.attach_command;
	const metadataSession = view.metadata?.pane_session_name ?? view.metadata?.tmux_session_name;
	if (typeof metadataSession === "string" && metadataSession.length > 0) {
		const backendKind = view.metadata?.pane_backend_kind;
		if (backendKind === "zellij") return { argv: ["zellij", "attach", metadataSession] };
		return { argv: ["tmux", "attach-session", "-t", metadataSession] };
	}
	if (!view.attach_hint) return null;
	const hint = view.attach_hint.trim();
	const tmuxMatch = TMUX_ATTACH_HINT_RE.exec(hint);
	if (tmuxMatch?.[1]) return { argv: ["tmux", "attach-session", "-t", tmuxMatch[1]] };
	const zellijMatch = ZELLIJ_ATTACH_HINT_RE.exec(hint);
	if (zellijMatch?.[1]) return { argv: ["zellij", "attach", zellijMatch[1]] };
	return null;
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

function attachArgsForTui(command: { argv: string[] }): string[] {
	const [bin, subcommand] = command.argv;
	if (bin === "tmux" && (subcommand === "attach" || subcommand === "attach-session")) {
		const sessionName = command.argv.at(-1);
		if (sessionName) return buildTmuxAttachArgs(sessionName);
	}
	return command.argv;
}

function zellijTeamPaneFocusArgs(view?: TaskStatusView): string[] | undefined {
	if (!view?.team_id || view.metadata?.pane_backend_kind !== "zellij") return undefined;
	const sessionName = view.metadata?.pane_session_name;
	if (typeof sessionName !== "string" || sessionName.length === 0) return undefined;
	const paneRef =
		(typeof view.native_task_id === "string" && view.native_task_id) ||
		(typeof view.metadata?.tmux_pane_id === "string" && view.metadata.tmux_pane_id) ||
		"";
	const paneId = paneRef.split("/").at(-1);
	if (!paneId || !/^terminal_\d+$/.test(paneId)) return undefined;
	return ["zellij", "--session", sessionName, "action", "focus-pane-id", paneId];
}

function preAttachArgsForTask(view?: TaskStatusView): string[][] | undefined {
	const focusArgs = zellijTeamPaneFocusArgs(view);
	return focusArgs ? [focusArgs] : undefined;
}

export function buildTuiTaskAttachExit(
	command: { argv: string[] },
	taskId: string,
	view?: TaskStatusView,
	returnMode: "tasks" | "parents" = "tasks",
): TuiExit {
	const preAttachArgs = preAttachArgsForTask(view);
	return {
		kind: "attach",
		...(preAttachArgs ? { preAttachArgs } : {}),
		args: attachArgsForTui(command),
		returnState: { mode: returnMode, selected_task_id: taskId },
	};
}

export function buildTuiTeamMemberAttachExit(
	command: { argv: string[] },
	teamId: string,
	taskId: string,
	view?: TaskStatusView,
): TuiExit {
	const preAttachArgs = preAttachArgsForTask(view);
	return {
		kind: "attach",
		...(preAttachArgs ? { preAttachArgs } : {}),
		args: attachArgsForTui(command),
		returnState: {
			mode: "teams",
			selected_team_id: teamId,
			selected_member_task_id: taskId,
			team_focus: "members",
		},
	};
}

export function buildTuiTeamAttachExit(command: { argv: string[] }, teamId: string): TuiExit {
	return {
		kind: "attach",
		args: attachArgsForTui(command),
		returnState: {
			mode: "teams",
			selected_team_id: teamId,
			team_focus: "list",
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
