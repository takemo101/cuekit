export type CuekitCommandClassification =
	| { kind: "help" }
	| { kind: "reserved-human"; command: "doctor" | "update" }
	| { kind: "delegate" };

export function classifyCuekitCommand(argv: string[]): CuekitCommandClassification {
	const command = argv[0];
	if (command === undefined || command === "--help" || command === "-h") {
		return { kind: "help" };
	}
	if (command === "doctor" || command === "update") {
		return { kind: "reserved-human", command };
	}
	return { kind: "delegate" };
}

export function printMainHelp(): string {
	return [
		"cuekit — delegation substrate for coding agents",
		"",
		"Usage: cuekit <command> [options]",
		"",
		"Human-only commands:",
		"  cuekit init  Create .cuekit.yaml and update .gitignore",
		"  cuekit tui   Open the interactive task cockpit",
		"",
		"Command groups:",
		"  task, team, adapter, agent, session, tool, mcp",
		"",
		"Use 'cuekit init --help' or 'cuekit tui --help' for human-only command help.",
		"",
	].join("\n");
}

export function printReservedHumanCommand(command: "doctor" | "update"): string {
	return `cuekit ${command} is reserved for a future human CLI command and is not implemented yet.\n`;
}
