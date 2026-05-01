import type { ReactNode } from "react";
import { theme } from "../theme.ts";
import { ModalFrame } from "./modal-frame.tsx";

export function ConfirmDialog(props: { title: string; message: string }): ReactNode {
	return (
		<ModalFrame title={props.title}>
			<text fg={theme.text}>{props.message}</text>
			<text fg={theme.muted}>Press y to confirm, n/Esc to cancel.</text>
		</ModalFrame>
	);
}
