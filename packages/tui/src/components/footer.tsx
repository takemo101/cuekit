import type { ReactNode } from "react";
import { theme } from "../theme.ts";

function key(label: string, text: string): string {
	return `${label} ${text}`;
}

export function Footer(props: { message?: string; error?: string; loading?: boolean }): ReactNode {
	const status = props.error ?? props.message ?? (props.loading ? "Loading..." : "Ready");
	const hotkeys = [
		key("↑/↓", "select"),
		key("r", "refresh"),
		key("a", "attach"),
		key("s", "steer"),
		key("c", "cancel"),
		key("d", "delete"),
		key("q", "quit"),
		key("auto", "3s"),
	].join("   ");
	return (
		<box borderStyle="single" borderColor={theme.border} backgroundColor={theme.panel} paddingX={1} height={3} flexDirection="row">
			<text fg={theme.cyan}>{hotkeys}</text>
			<text fg={props.error ? theme.red : theme.green}>{` — ${status}`}</text>
		</box>
	);
}
