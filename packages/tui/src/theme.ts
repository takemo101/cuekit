export const theme = {
	bg: "#2b2b2b",
	headerBg: "#1a1a1a",
	headerFg: "#76c7c8",
	panel: "#303030",
	panelAlt: "#242424",
	row: "#1b1b1b",
	rowAlt: "#333333",
	rowSelected: "#4a4a4a",
	border: "#5a5a5a",
	muted: "#777777",
	text: "#d7d7d7",
	strong: "#eeeeee",
	cyan: "#76c7c8",
	green: "#7fb36a",
	yellow: "#d6bb6b",
	red: "#cf6f6a",
	blue: "#8ea0ff",
	purple: "#b19cd9",
} as const;

export function statusAccent(status: string): string {
	if (status === "completed") return theme.green;
	if (status === "failed" || status === "timed_out" || status === "blocked") return theme.red;
	if (status === "cancelled") return theme.yellow;
	if (status === "input_required") return theme.purple;
	return theme.cyan;
}

export function statusGlyph(status: string): string {
	if (status === "completed") return "●";
	if (status === "failed" || status === "timed_out" || status === "blocked") return "●";
	if (status === "cancelled") return "◐";
	if (status === "input_required") return "◆";
	return "○";
}
