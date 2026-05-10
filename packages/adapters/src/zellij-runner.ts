import { execFileSync } from "node:child_process";

export interface ZellijRunResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

/**
 * Thin runner interface so ZellijBackend can be unit-tested with an
 * in-memory fake instead of a live zellij process. The default
 * implementation shells out via Node's execFileSync. Using Node's child-process
 * wrapper avoids Bun test runs tracking zellij background servers spawned by
 * `attach --create-background` as dangling child processes.
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
				const stdout = execFileSync("zellij", args, {
					encoding: "utf8",
					stdio: ["ignore", "pipe", "pipe"],
				});
				return { stdout, stderr: "", exitCode: 0 };
			} catch (error) {
				const failure = error as {
					status?: number;
					stdout?: Buffer | string;
					stderr?: Buffer | string;
				};
				return {
					stdout: failure.stdout?.toString() ?? "",
					stderr: failure.stderr?.toString() ?? "",
					exitCode: failure.status ?? 1,
				};
			}
		},
	};
}
