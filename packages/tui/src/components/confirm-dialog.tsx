import type { ReactNode } from "react";

export function ConfirmDialog(props: { title: string; message: string }): ReactNode {
	return (
		<box borderStyle="double" padding={1} flexDirection="column">
			<text fg="#e0af68">{props.title}</text>
			<text>{props.message}</text>
			<text fg="#888888">Press y to confirm, n/Esc to cancel.</text>
		</box>
	);
}
