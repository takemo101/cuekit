import type { ReactNode } from "react";
import { theme } from "../theme.ts";

export function ModalFrame(props: { title: string; children: ReactNode }): ReactNode {
	return (
		<box
			position="absolute"
			left="25%"
			top="30%"
			width="50%"
			borderStyle="double"
			borderColor={theme.cyan}
			padding={1}
			flexDirection="column"
			zIndex={100}
			backgroundColor={theme.panel}
		>
			<text fg={theme.yellow}>{props.title}</text>
			{props.children}
		</box>
	);
}
