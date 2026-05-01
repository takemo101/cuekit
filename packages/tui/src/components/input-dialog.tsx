import type { ReactNode } from "react";
import { theme } from "../theme.ts";
import { ModalFrame } from "./modal-frame.tsx";

export function InputDialog(props: { title: string; placeholder?: string; value: string }): ReactNode {
	const visibleValue = props.value.length > 0 ? props.value : (props.placeholder ?? "Type message...");
	return (
		<ModalFrame title={props.title}>
			<box borderStyle="single" borderColor={theme.border} backgroundColor={theme.panelAlt} padding={1}>
				<text fg={theme.text}>{`> ${visibleValue}`}</text>
			</box>
			<text fg={theme.muted}>Enter submits, Backspace edits, Esc cancels.</text>
		</ModalFrame>
	);
}
