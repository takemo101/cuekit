import type { ReactNode } from "react";
import { ModalFrame } from "./modal-frame.tsx";

export function ConfirmDialog(props: { title: string; message: string }): ReactNode {
	return (
		<ModalFrame title={props.title}>
			<text>{props.message}</text>
			<text fg="#888888">Press y to confirm, n/Esc to cancel.</text>
		</ModalFrame>
	);
}
