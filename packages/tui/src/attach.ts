import type { TaskStatusView } from "@cuekit/core";

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

export async function runTmuxAttach(sessionName: string): Promise<number> {
	const proc = Bun.spawn(buildTmuxAttachArgs(sessionName), {
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	});
	return proc.exited;
}
