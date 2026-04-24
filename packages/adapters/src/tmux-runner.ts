export interface TmuxRunResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

// Thin runner interface so PaneBackend can be unit-tested with an in-memory
// fake instead of a live tmux process. The default implementation shells out
// via Bun.spawn.
export interface TmuxRunner {
	run(args: string[]): Promise<TmuxRunResult>;
}

export function defaultTmuxRunner(): TmuxRunner {
	return {
		async run(args: string[]): Promise<TmuxRunResult> {
			const proc = Bun.spawn(["tmux", ...args], {
				stdout: "pipe",
				stderr: "pipe",
			});
			const exitCode = await proc.exited;
			const stdout = await new Response(proc.stdout).text();
			const stderr = await new Response(proc.stderr).text();
			return { stdout, stderr, exitCode };
		},
	};
}
