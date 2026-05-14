import type { ReactNode } from "react";
import { truncateEnd } from "../format.ts";
import type { TeamFocus, TuiMode } from "../tui-state.ts";
import { theme } from "../theme.ts";

const TASK_FULL_HOTKEYS = ["↑/↓|j/k select", "r refresh"];
const TASK_ATTACH_FULL_HOTKEY = "a attach";
const TASK_TRAILING_FULL_HOTKEYS = ["t teams", "p parents", "s steer", "c cancel", "d delete", "q quit", "auto 3s"];
const PARENT_TRAILING_FULL_HOTKEYS = ["t teams", "p tasks", "n new parent", "s steer", "c cancel", "d delete", "q quit", "auto 3s"];

const TASK_COMPACT_HOTKEYS = "↑/↓|j/k sel  r ref";
const TASK_ATTACH_COMPACT_HOTKEY = "a att";
const TASK_TRAILING_COMPACT_HOTKEYS = "t teams  p parents  s steer  c cancel  d del  q quit  auto3s";
const PARENT_TRAILING_COMPACT_HOTKEYS = "t teams  p tasks  n new  s steer  c cancel  d del  q quit  auto3s";
// Switch to compact hotkeys below ~80-column terminals after border/status padding.
const COMPACT_SELECTION_WIDTH = 72;

function taskFullHotkeys(attachable: boolean, parents = false): string {
	return [
		...TASK_FULL_HOTKEYS,
		...(attachable ? [TASK_ATTACH_FULL_HOTKEY] : []),
		...(parents ? PARENT_TRAILING_FULL_HOTKEYS : TASK_TRAILING_FULL_HOTKEYS),
	].join("   ");
}

function taskCompactHotkeys(attachable: boolean, parents = false): string {
	return [
		TASK_COMPACT_HOTKEYS,
		...(attachable ? [TASK_ATTACH_COMPACT_HOTKEY] : []),
		parents ? PARENT_TRAILING_COMPACT_HOTKEYS : TASK_TRAILING_COMPACT_HOTKEYS,
	].join("  ");
}

function teamHotkeys(focus: TeamFocus, attachable: boolean, compact: boolean): string {
	if (compact) {
		return focus === "members"
			? `${attachable ? "a att  " : ""}A team  esc list  j/k member  r ref  t tasks  p parents  q quit  auto3s`
			: "j/k team  enter  A attach team  c clean  d del empty  t tasks  p parents  r ref  q quit  auto3s";
	}
	return focus === "members"
		? [
				...(attachable ? ["a attach member"] : []),
				"A attach team",
				"esc team list",
				"↑/↓|j/k member",
				"r refresh",
				"t tasks",
				"p parents",
				"q quit",
				"auto 3s",
			].join("   ")
		: [
				"↑/↓|j/k team",
				"enter members",
				"A attach team",
				"c cleanup",
				"d delete empty",
				"t tasks",
				"p parents",
				"r refresh",
				"q quit",
				"auto 3s",
			].join(
				"   ",
			);
}

function fullHotkeys(mode: TuiMode, attachable: boolean, teamFocus: TeamFocus): string {
	return mode === "teams"
		? teamHotkeys(teamFocus, attachable, false)
		: taskFullHotkeys(attachable, mode === "parents");
}

function compactHotkeys(mode: TuiMode, attachable: boolean, teamFocus: TeamFocus): string {
	return mode === "teams"
		? teamHotkeys(teamFocus, attachable, true)
		: taskCompactHotkeys(attachable, mode === "parents");
}

export function footerLine(
	status: string,
	terminalWidth: number,
	options: {
		attachable?: boolean;
		mode?: TuiMode;
		teamFocus?: TeamFocus;
	} = {},
): string {
	const available = Math.max(0, terminalWidth - 4);
	if (available === 0) return "";
	const attachable = options.attachable ?? true;
	const mode = options.mode ?? "tasks";
	const teamFocus = options.teamFocus ?? "list";
	const full = fullHotkeys(mode, attachable, teamFocus);
	const compact = compactHotkeys(mode, attachable, teamFocus);
	const hotkeys = full.length + status.length + 3 <= available ? full : compact;
	const candidate = available >= COMPACT_SELECTION_WIDTH ? `${hotkeys} — ${status}` : `${compact} — ${status}`;
	return truncateEnd(candidate, available);
}

export function Footer(props: {
	message?: string;
	error?: string;
	loading?: boolean;
	terminalWidth?: number;
	attachable?: boolean;
	mode?: TuiMode;
	teamFocus?: TeamFocus;
}): ReactNode {
	const status = props.error ?? props.message ?? (props.loading ? "Loading..." : "Ready");
	const terminalWidth = props.terminalWidth ?? 80;
	return (
		<box borderStyle="single" borderColor={theme.border} backgroundColor={theme.panel} paddingX={1} height={3}>
			<text fg={props.error ? theme.red : theme.cyan}>
				{footerLine(status, terminalWidth, {
					attachable: props.attachable,
					mode: props.mode,
					teamFocus: props.teamFocus,
				})}
			</text>
		</box>
	);
}
