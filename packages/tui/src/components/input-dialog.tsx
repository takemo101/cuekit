import type { ReactNode } from "react";

export function InputDialog(props: { title: string; placeholder?: string; value: string }): ReactNode {
	const visibleValue = props.value.length > 0 ? props.value : (props.placeholder ?? "Type message...");
	return (
		<box borderStyle="double" padding={1} flexDirection="column">
			<text fg="#e0af68">{props.title}</text>
			<text>{`> ${visibleValue}`}</text>
			<text fg="#888888">Enter submits, Backspace edits, Esc cancels.</text>
		</box>
	);
}
