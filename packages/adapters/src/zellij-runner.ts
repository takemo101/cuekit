import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ZellijRunResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

/**
 * Thin runner interface so ZellijBackend can be unit-tested with an
 * in-memory fake instead of a live zellij process. The default
 * implementation shells out via Node's async execFile. Using Node's child-process
 * wrapper avoids Bun test runs tracking zellij background servers spawned by
 * `attach --create-background` as dangling child processes, while keeping TUI
 * redraw timers responsive during slower zellij queries.
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
			try {
				const { stdout, stderr } = await execFileAsync("zellij", args, {
					encoding: "utf8",
					maxBuffer: 10 * 1024 * 1024,
				});
				return { stdout, stderr, exitCode: 0 };
			} catch (error) {
				const failure = error as {
					code?: number | string;
					stdout?: Buffer | string;
					stderr?: Buffer | string;
				};
				return {
					stdout: failure.stdout?.toString() ?? "",
					stderr: failure.stderr?.toString() ?? "",
					exitCode: typeof failure.code === "number" ? failure.code : 1,
				};
			}
		},
	};
}
