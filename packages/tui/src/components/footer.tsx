import type { ReactNode } from "react";
import { truncateEnd } from "../format.ts";
import { theme } from "../theme.ts";

const FULL_HOTKEYS = [
	"↑/↓|j/k select",
	"r refresh",
	"a attach",
	"s steer",
	"c cancel",
	"d delete",
	"q quit",
	"auto 3s",
].join("   ");

const COMPACT_HOTKEYS = "↑/↓|j/k sel  r ref  a att  s steer  c cancel  d del  q quit  auto3s";
const COMPACT_SELECTION_WIDTH = 72;

export function footerLine(status: string, terminalWidth: number): string {
	const available = Math.max(0, terminalWidth - 4);
	if (available === 0) return "";
	const hotkeys = FULL_HOTKEYS.length + status.length + 3 <= available ? FULL_HOTKEYS : COMPACT_HOTKEYS;
	const candidate = available >= COMPACT_SELECTION_WIDTH ? `${hotkeys} — ${status}` : `${COMPACT_HOTKEYS} — ${status}`;
	return truncateEnd(candidate, available);
}

export function Footer(props: {
	message?: string;
	error?: string;
	loading?: boolean;
	terminalWidth?: number;
}): ReactNode {
	const status = props.error ?? props.message ?? (props.loading ? "Loading..." : "Ready");
	const terminalWidth = props.terminalWidth ?? 80;
	return (
		<box borderStyle="single" borderColor={theme.border} backgroundColor={theme.panel} paddingX={1} height={3}>
			<text fg={props.error ? theme.red : theme.cyan}>{footerLine(status, terminalWidth)}</text>
		</box>
	);
}
