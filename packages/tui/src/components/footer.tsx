import type { ReactNode } from "react";

export function Footer(props: { message?: string; error?: string; loading?: boolean }): ReactNode {
	const status = props.error ?? props.message ?? (props.loading ? "Loading..." : "Ready");
	return (
		<box borderStyle="single" paddingX={1} height={3}>
			<text fg={props.error ? "#f7768e" : "#9ece6a"}>
				{`[↑/↓|j/k] select  [r] refresh  [a] attach  [s] steer  [c] cancel  [d] delete  [q] quit  — ${status}`}
			</text>
		</box>
	);
}
