import type { TmuxRunner, TmuxRunResult } from "./tmux-runner.ts";

// In-memory tmux simulator for tests in this package and downstream consumers.
// Tracks which sessions exist, fabricates pane ids, and records every
// invocation so tests can assert on the command sequence. Shared across
// @cuekit/adapters and @cuekit/mcp tests so the simulator behavior stays
// in one place.
export class FakeTmuxRunner implements TmuxRunner {
	readonly calls: string[][] = [];
	private readonly sessions = new Set<string>();
	private paneCounter = 0;
	// Optional override for the next result (FIFO).
	private readonly queuedResponses: TmuxRunResult[] = [];

	queueResponse(result: TmuxRunResult): void {
		this.queuedResponses.push(result);
	}

	knownSessions(): string[] {
		return [...this.sessions];
	}

	async run(args: string[]): Promise<TmuxRunResult> {
		this.calls.push([...args]);
		if (this.queuedResponses.length > 0) {
			return this.queuedResponses.shift() as TmuxRunResult;
		}

		const cmd = args[0];
		switch (cmd) {
			case "new-session": {
				const sessionName = findFlagValue(args, "-s");
				if (sessionName) this.sessions.add(sessionName);
				this.paneCounter += 1;
				return { stdout: `%${this.paneCounter}\n`, stderr: "", exitCode: 0 };
			}
			case "has-session": {
				const sessionName = findFlagValue(args, "-t");
				return {
					stdout: "",
					stderr: "",
					exitCode: sessionName && this.sessions.has(sessionName) ? 0 : 1,
				};
			}
			case "kill-session": {
				const sessionName = findFlagValue(args, "-t");
				if (sessionName) this.sessions.delete(sessionName);
				return { stdout: "", stderr: "", exitCode: 0 };
			}
			case "pipe-pane":
			case "send-keys":
				return { stdout: "", stderr: "", exitCode: 0 };
			default:
				return { stdout: "", stderr: "", exitCode: 0 };
		}
	}
}

function findFlagValue(args: string[], flag: string): string | undefined {
	const idx = args.indexOf(flag);
	if (idx < 0 || idx + 1 >= args.length) return undefined;
	return args[idx + 1];
}

// Integration-test helpers: detect whether `tmux` is installed on PATH so
// test suites can opt into real-tmux coverage without hard-failing on
// machines without tmux. Exported so multiple integ suites can share the
// same probe without re-implementing it.
export function hasTmux(): boolean {
	try {
		const proc = Bun.spawnSync(["tmux", "-V"], { stdout: "pipe", stderr: "pipe" });
		return proc.exitCode === 0;
	} catch {
		return false;
	}
}

export function hasZellij(): boolean {
	try {
		const proc = Bun.spawnSync(["zellij", "--version"], { stdout: "pipe", stderr: "pipe" });
		return proc.exitCode === 0;
	} catch {
		return false;
	}
}

import type { ZellijRunner, ZellijRunResult } from "./zellij-runner.ts";

/**
 * In-memory zellij simulator for unit tests. Tracks sessions, fabricates pane
 * ids in the `terminal_<n>` shape zellij uses, and records every invocation
 * so tests can assert on argv shape.
 */
export class FakeZellijRunner implements ZellijRunner {
	readonly calls: string[][] = [];
	private layoutContent: string | undefined;
	private readonly sessions = new Set<string>();
	private readonly panesBySession = new Map<string, Set<number>>();
	private readonly queuedResponses: ZellijRunResult[] = [];
	private paneCounter = 0;

	queueResponse(result: ZellijRunResult): void {
		this.queuedResponses.push(result);
	}

	knownSessions(): string[] {
		return [...this.sessions];
	}

	closePane(sessionName: string, paneId: number): void {
		this.panesBySession.get(sessionName)?.delete(paneId);
	}

	lastLayout(): string {
		return this.layoutContent ?? "";
	}

	async run(args: string[]): Promise<ZellijRunResult> {
		this.calls.push([...args]);
		if (this.queuedResponses.length > 0) {
			return this.queuedResponses.shift() as ZellijRunResult;
		}

		// Top-level commands first.
		const cmd = args[0];
		if (cmd === "--version") {
			return { stdout: "zellij 0.44.2\n", stderr: "", exitCode: 0 };
		}
		if (cmd === "attach") {
			// `zellij attach --create-background <name> [options --default-layout <path>]`
			const idx = args.indexOf("--create-background");
			const sessionName = args[idx + 1];
			if (idx >= 0 && sessionName) {
				this.sessions.add(sessionName);
				this.panesBySession.set(sessionName, new Set([0]));
				const layoutIdx = args.indexOf("--default-layout");
				const layoutPath = args[layoutIdx + 1];
				if (layoutIdx >= 0 && layoutPath) {
					this.layoutContent = await Bun.file(layoutPath).text();
				}
				return { stdout: "", stderr: "", exitCode: 0 };
			}
			return { stdout: "", stderr: "", exitCode: 0 };
		}
		if (cmd === "list-sessions") {
			return { stdout: [...this.sessions].join("\n"), stderr: "", exitCode: 0 };
		}
		if (cmd === "kill-session") {
			// args: ["kill-session", "<session-name>"]
			const sessionName = args[1];
			if (sessionName) {
				this.sessions.delete(sessionName);
				this.panesBySession.delete(sessionName);
			}
			return { stdout: "", stderr: "", exitCode: 0 };
		}

		// Action subcommands: `--session <name> action <verb> ...`
		if (cmd === "--session") {
			const sessionName = args[1] ?? "";
			const verb = args[3] ?? "";
			if (verb === "new-pane") {
				if (!this.sessions.has(sessionName)) {
					return { stdout: "", stderr: "session not found", exitCode: 1 };
				}
				this.paneCounter += 1;
				this.panesBySession.get(sessionName)?.add(this.paneCounter);
				return { stdout: `terminal_${this.paneCounter}\n`, stderr: "", exitCode: 0 };
			}
			if (verb === "list-panes") {
				const panes = [...(this.panesBySession.get(sessionName) ?? [])].map((id) => ({
					id,
					exited: false,
				}));
				return { stdout: JSON.stringify(panes), stderr: "", exitCode: 0 };
			}
			if (verb === "close-pane") {
				const paneFlag = args.indexOf("-p");
				const paneId = paneFlag >= 0 ? args[paneFlag + 1] : undefined;
				const numeric = paneId?.match(/^terminal_(\d+)$/)?.[1];
				if (numeric) this.panesBySession.get(sessionName)?.delete(Number.parseInt(numeric, 10));
				return { stdout: "", stderr: "", exitCode: 0 };
			}
			if (verb === "write-chars" || verb === "write") {
				return { stdout: "", stderr: "", exitCode: 0 };
			}
			if (verb === "dump-screen") {
				const pathFlag = args.indexOf("--path");
				let pathArg = pathFlag >= 0 ? args[pathFlag + 1] : undefined;
				if (!pathArg) {
					// 0.43 compatibility: path is positional.
					for (let i = 4; i < args.length; i++) {
						const arg = args[i];
						if (arg && !arg.startsWith("--") && arg !== "-f" && arg !== "--full" && arg !== "-p") {
							pathArg = arg;
							break;
						}
					}
				}
				if (pathArg) {
					await Bun.write(pathArg, "fake screen output\n");
				}
				return { stdout: "", stderr: "", exitCode: 0 };
			}
		}

		return { stdout: "", stderr: "", exitCode: 0 };
	}
}
