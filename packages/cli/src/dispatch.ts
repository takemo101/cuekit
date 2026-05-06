export type CuekitCommandClassification =
	| { kind: "help" }
	| { kind: "doctor" }
	| { kind: "reserved-human"; command: "update" }
	| { kind: "delegate" };

export function classifyCuekitCommand(argv: string[]): CuekitCommandClassification {
	const command = argv[0];
	if (command === undefined || command === "--help" || command === "-h") {
		return { kind: "help" };
	}
	if (command === "doctor") {
		return { kind: "doctor" };
	}
	if (command === "update") {
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
		"  cuekit init    Create .cuekit.yaml and update .gitignore",
		"  cuekit tui     Open the interactive task cockpit",
		"  cuekit doctor  Diagnose local cuekit setup",
		"",
		"Command groups:",
		"  task, team, adapter, agent, session, tool, mcp",
		"",
		"Use 'cuekit init --help' or 'cuekit tui --help' for human-only command help.",
		"",
	].join("\n");
}

export function printDoctorHelp(): string {
	return [
		"cuekit doctor — diagnose local cuekit setup",
		"",
		"Usage: cuekit doctor [options]",
		"",
		"Options:",
		"  -h, --help  Show this help message",
		"",
		"Checks:",
		"  cuekit version, bun, tmux, state db, project config, MCP config helper, update",
		"",
		"Exit codes:",
		"  0  All required checks pass (warnings are non-blocking)",
		"  1  One or more required checks failed",
		"",
	].join("\n");
}

export function printReservedHumanCommand(command: "update"): string {
	return `cuekit ${command} is reserved for a future human CLI command and is not implemented yet.\n`;
}
