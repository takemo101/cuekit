export type CheckLevel = "ok" | "warn" | "fail";

export type CheckLine = {
	level: CheckLevel;
	label: string;
	detail: string;
};

const SYMBOLS: Record<CheckLevel, string> = {
	ok: "✓",
	warn: "!",
	fail: "✗",
};

export function formatCheckLine(line: CheckLine): string {
	return `${SYMBOLS[line.level]} ${line.label}: ${line.detail}`;
}

export function formatCommandBlock(label: string, command: string): string {
	return `${label}:\n\n  ${command}\n`;
}
