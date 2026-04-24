import { shellQuote } from "./shell-quote.ts";
import { defaultTmuxRunner, type TmuxRunner } from "./tmux-runner.ts";

export interface PaneBackendOptions {
	runner?: TmuxRunner;
	// Delay between `send-keys -l <msg>` and the Enter press. Matches isuner's
	// proven TUI-safe steering cadence.
	sendKeysDelayMs?: number;
}

export interface SpawnTaskParams {
	task_id: string;
	launchCommand: string;
	cwd: string;
	transcriptPath?: string;
}

export interface PaneHandle {
	task_id: string;
	tmux_session_name: string;
	pane_id: string;
	attach_hint: string;
}

export class PaneBackend {
	private readonly runner: TmuxRunner;
	private readonly sendKeysDelayMs: number;

	constructor(options: PaneBackendOptions = {}) {
		this.runner = options.runner ?? defaultTmuxRunner();
		this.sendKeysDelayMs = options.sendKeysDelayMs ?? 200;
	}

	sessionNameFor(task_id: string): string {
		return `cuekit-task-${task_id}`;
	}

	computeAttachHint(task_id: string): string {
		return `tmux attach-session -t ${this.sessionNameFor(task_id)}`;
	}

	async spawnTask(params: SpawnTaskParams): Promise<PaneHandle> {
		const sessionName = this.sessionNameFor(params.task_id);
		const result = await this.runner.run([
			"new-session",
			"-d",
			"-s",
			sessionName,
			"-c",
			params.cwd,
			"-P",
			"-F",
			"#{pane_id}",
			params.launchCommand,
		]);
		if (result.exitCode !== 0) {
			throw new Error(
				`tmux new-session for task ${params.task_id} failed (exit ${result.exitCode}): ${result.stderr.trim()}`,
			);
		}
		const pane_id = result.stdout.trim();
		if (!pane_id) {
			throw new Error(`tmux new-session for task ${params.task_id} did not report a pane id`);
		}

		if (params.transcriptPath) {
			const pipeResult = await this.runner.run([
				"pipe-pane",
				"-t",
				pane_id,
				"-o",
				`cat > ${shellQuote(params.transcriptPath)}`,
			]);
			if (pipeResult.exitCode !== 0) {
				throw new Error(
					`tmux pipe-pane for task ${params.task_id} failed: ${pipeResult.stderr.trim()}`,
				);
			}
		}

		return {
			task_id: params.task_id,
			tmux_session_name: sessionName,
			pane_id,
			attach_hint: this.computeAttachHint(params.task_id),
		};
	}

	async isAlive(task_id: string): Promise<boolean> {
		const result = await this.runner.run(["has-session", "-t", this.sessionNameFor(task_id)]);
		return result.exitCode === 0;
	}

	// Two-step send-keys cadence proven by isuner: literal text, short delay,
	// Enter. A single `send-keys "<msg>" Enter` can drop characters on rich
	// TUIs.
	async sendKeys(task_id: string, message: string): Promise<void> {
		const target = this.sessionNameFor(task_id);
		const literal = await this.runner.run(["send-keys", "-t", target, "-l", message]);
		if (literal.exitCode !== 0) {
			throw new Error(`tmux send-keys -l for task ${task_id} failed: ${literal.stderr.trim()}`);
		}
		if (this.sendKeysDelayMs > 0) {
			await Bun.sleep(this.sendKeysDelayMs);
		}
		const enter = await this.runner.run(["send-keys", "-t", target, "Enter"]);
		if (enter.exitCode !== 0) {
			throw new Error(`tmux send-keys Enter for task ${task_id} failed: ${enter.stderr.trim()}`);
		}
	}

	async killTask(task_id: string): Promise<void> {
		const result = await this.runner.run(["kill-session", "-t", this.sessionNameFor(task_id)]);
		// Missing session is idempotent success — killing an already-gone task
		// is not an error. Real tmux's wording varies: "can't find session" on
		// macOS, "session not found" on some distros, "no such session" on
		// others; match all three.
		if (
			result.exitCode !== 0 &&
			!/can't find session|session not found|no such session|no server running/i.test(result.stderr)
		) {
			throw new Error(`tmux kill-session for task ${task_id} failed: ${result.stderr.trim()}`);
		}
	}
}
