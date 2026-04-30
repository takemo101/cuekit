import type { ReactNode } from "react";
import { ModalFrame } from "./modal-frame.tsx";

export function InputDialog(props: { title: string; placeholder?: string; value: string }): ReactNode {
	const visibleValue = props.value.length > 0 ? props.value : (props.placeholder ?? "Type message...");
	return (
		<ModalFrame title={props.title}>
			<box borderStyle="single" padding={1}>
				<text>{`> ${visibleValue}`}</text>
			</box>
			<text fg="#888888">Enter submits, Backspace edits, Esc cancels.</text>
		</ModalFrame>
	);
}
