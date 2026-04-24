import type { TmuxRunner, TmuxRunResult } from "../src/tmux-runner.ts";

// In-memory tmux simulator for unit tests. Tracks which sessions exist,
// fabricates pane ids, and records every invocation so tests can assert on
// the command sequence.
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
