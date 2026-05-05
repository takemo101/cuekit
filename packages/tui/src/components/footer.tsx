import type { ReactNode } from "react";
import { truncateEnd } from "../format.ts";
import { theme } from "../theme.ts";

const BASE_FULL_HOTKEYS = ["↑/↓|j/k select", "r refresh"];
const ATTACH_FULL_HOTKEY = "a attach";
const TRAILING_FULL_HOTKEYS = ["s steer", "c cancel", "d delete", "q quit", "auto 3s"];

const BASE_COMPACT_HOTKEYS = "↑/↓|j/k sel  r ref";
const ATTACH_COMPACT_HOTKEY = "a att";
const TRAILING_COMPACT_HOTKEYS = "s steer  c cancel  d del  q quit  auto3s";
const COMPACT_SELECTION_WIDTH = 72;

function fullHotkeys(attachable: boolean): string {
	return [
		...BASE_FULL_HOTKEYS,
		...(attachable ? [ATTACH_FULL_HOTKEY] : []),
		...TRAILING_FULL_HOTKEYS,
	].join("   ");
}

function compactHotkeys(attachable: boolean): string {
	return [
		BASE_COMPACT_HOTKEYS,
		...(attachable ? [ATTACH_COMPACT_HOTKEY] : []),
		TRAILING_COMPACT_HOTKEYS,
	].join("  ");
}

export function footerLine(
	status: string,
	terminalWidth: number,
	options: { attachable?: boolean } = {},
): string {
	const available = Math.max(0, terminalWidth - 4);
	if (available === 0) return "";
	const attachable = options.attachable ?? true;
	const full = fullHotkeys(attachable);
	const compact = compactHotkeys(attachable);
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
}): ReactNode {
	const status = props.error ?? props.message ?? (props.loading ? "Loading..." : "Ready");
	const terminalWidth = props.terminalWidth ?? 80;
	return (
		<box borderStyle="single" borderColor={theme.border} backgroundColor={theme.panel} paddingX={1} height={3}>
			<text fg={props.error ? theme.red : theme.cyan}>
				{footerLine(status, terminalWidth, { attachable: props.attachable })}
			</text>
		</box>
	);
}
