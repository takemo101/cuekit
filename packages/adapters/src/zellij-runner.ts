export interface ZellijRunResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

/**
 * Thin runner interface so ZellijBackend can be unit-tested with an
 * in-memory fake instead of a live zellij process. The default
 * implementation shells out via Bun.spawn.
 *
 * Mirror of TmuxRunner — kept as a separate type so that the FakeRunners
 * for each backend can stay focused.
 */
export interface ZellijRunner {
	run(args: string[]): Promise<ZellijRunResult>;
}

export function defaultZellijRunner(): ZellijRunner {
	return {
		async run(args: string[]): Promise<ZellijRunResult> {
			const proc = Bun.spawn(["zellij", ...args], {
				stdin: "ignore",
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
