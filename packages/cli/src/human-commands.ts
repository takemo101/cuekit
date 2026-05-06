import { registerPiMcpServer } from "@cuekit/mcp";
import { type ProjectConfigInitResult, runProjectConfigInit } from "@cuekit/project-config";

export type HumanCommandResult = {
	exitCode: number;
	stdout: string;
	stderr?: string;
};

export type RunInitDependencies = {
	cwd?: string;
	runProjectConfigInit?: typeof runProjectConfigInit;
};

export function printInitHelp(): string {
	return [
		"cuekit init — create safe project-local cuekit config",
		"",
		"Usage: cuekit init [--dry-run] [--force] [--no-gitignore] [--unsafe-bypass]",
		"",
		"Creates .cuekit.yaml in the current directory and adds .cuekit/tasks/ to .gitignore.",
		"",
		"Options:",
		"  --dry-run       Show what would be written without changing files",
		"  --force         Overwrite an existing .cuekit.yaml",
		"  --no-gitignore  Do not create or update .gitignore",
		"  --unsafe-bypass Generate adapter permissions: bypass (unsafe; explicit opt-in)",
		"  -h, --help      Show this help",
		"",
	].join("\n");
}

function formatInitSummary(result: ProjectConfigInitResult): string {
	const prefix = result.dryRun ? "dry-run: " : "";
	const lines = [
		`${prefix}cuekit init ${result.dryRun ? "would update" : "updated"} ${result.cwd}`,
	];
	for (const path of result.created) lines.push(`${prefix}created ${path}`);
	for (const path of result.updated) lines.push(`${prefix}updated ${path}`);
	for (const path of result.skipped) lines.push(`${prefix}skipped ${path}`);
	return `${lines.join("\n")}\n`;
}

export function runInitCommand(
	argv: string[],
	dependencies: RunInitDependencies = {},
): HumanCommandResult {
	if (argv.includes("--help") || argv.includes("-h")) {
		return { exitCode: 0, stdout: printInitHelp() };
	}
	const unsafeBypass = argv.includes("--unsafe-bypass");
	try {
		const result = (dependencies.runProjectConfigInit ?? runProjectConfigInit)({
			cwd: dependencies.cwd ?? process.cwd(),
			dryRun: argv.includes("--dry-run"),
			force: argv.includes("--force"),
			gitignore: !argv.includes("--no-gitignore"),
			unsafeBypass,
		});
		return {
			exitCode: 0,
			stdout: formatInitSummary(result),
			...(unsafeBypass
				? {
						stderr:
							"warning: --unsafe-bypass writes project-local adapter permissions: bypass; only use this for trusted repositories\n",
					}
				: {}),
		};
	} catch (err) {
		return {
			exitCode: 1,
			stdout: "",
			stderr: `${err instanceof Error ? err.message : String(err)}\n`,
		};
	}
}

export function printTuiHelp(): string {
	return [
		"cuekit tui — interactive task cockpit",
		"",
		"Usage: cuekit tui [--path] [--all]",
		"",
		"By default, uses .cuekit.yaml project scope when present, otherwise the current repository/worktree.",
		"Use --path to ignore .cuekit.yaml identity and scope by the current path/Git root.",
		"Use --all to show tasks across all projects for this invocation.",
		"",
		"Keys: ↑/↓ select, r refresh, a attach (returns after detach), t teams/tasks, s steer, c cancel, d delete, q quit",
		"",
	].join("\n");
}

export function splitPiAgentArgs(argv: string[]): { hasPi: boolean; rest: string[] } {
	const rest: string[] = [];
	let hasPi = false;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === undefined) continue;
		if ((arg === "--agent" || arg === "-a") && argv[i + 1] === "pi") {
			hasPi = true;
			i++;
			continue;
		}
		if (arg === "--agent=pi" || arg === "-a=pi") {
			hasPi = true;
			continue;
		}
		rest.push(arg);
	}
	return { hasPi, rest };
}

export function hasExplicitAgent(argv: string[]): boolean {
	return argv.some(
		(arg) =>
			arg === "--agent" || arg === "-a" || arg.startsWith("--agent=") || arg.startsWith("-a="),
	);
}

export function runPiMcpAddCommand(
	argv: string[],
): HumanCommandResult & { shouldDelegate: boolean; delegateArgv: string[] } {
	const piAgents = splitPiAgentArgs(argv);
	if (!piAgents.hasPi) {
		return { exitCode: 0, stdout: "", shouldDelegate: true, delegateArgv: ["mcp", "add", ...argv] };
	}

	const result = registerPiMcpServer({
		global: !piAgents.rest.includes("--no-global"),
	});
	return {
		exitCode: 0,
		stdout: `Registered MCP server '${result.serverName}' for Pi: ${result.path}\n`,
		shouldDelegate: hasExplicitAgent(piAgents.rest),
		delegateArgv: ["mcp", "add", ...piAgents.rest],
	};
}
