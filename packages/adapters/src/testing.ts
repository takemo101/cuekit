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
