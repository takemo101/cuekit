import type { ReactNode } from "react";

export function ModalFrame(props: { title: string; children: ReactNode }): ReactNode {
	return (
		<box
			position="absolute"
			left="25%"
			top="30%"
			width="50%"
			borderStyle="double"
			padding={1}
			flexDirection="column"
			zIndex={100}
			backgroundColor="#1a1b26"
		>
			<text fg="#e0af68">{props.title}</text>
			{props.children}
		</box>
	);
}
