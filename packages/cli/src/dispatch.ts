export type CuekitCommandClassification =
	| { kind: "help" }
	| { kind: "doctor" }
	| { kind: "update" }
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
		return { kind: "update" };
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
		"  cuekit update  Show the latest Bun/GitHub install command",
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

export function printUpdateHelp(): string {
	return [
		"cuekit update — check for a newer cuekit release",
		"",
		"Usage: cuekit update [options]",
		"",
		"Options:",
		"  -h, --help  Show this help message",
		"",
		"Prints the current installed version and the latest stable release tag from",
		"GitHub, then shows the exact bun command to upgrade.",
		"",
		"Update is advisory only: it never runs bun install automatically.",
		"After upgrading, restart any MCP client that uses cuekit.",
		"",
	].join("\n");
}
