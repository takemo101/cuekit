import type {
	CaptureOptions,
	MultiplexerBackend,
	PaneHandle,
	SpawnPaneParams,
} from "./multiplexer-backend.ts";
import { shellQuote } from "./shell-quote.ts";
import { defaultTmuxRunner, type TmuxRunner } from "./tmux-runner.ts";

export interface TmuxBackendOptions {
	runner?: TmuxRunner;
	// Delay between `send-keys -l <msg>` and the Enter press. Matches isuner's
	// proven TUI-safe steering cadence.
	sendKeysDelayMs?: number;
}

const DEFAULT_CAPTURE_SCROLLBACK = 200;

export class TmuxBackend implements MultiplexerBackend {
	readonly kind = "tmux";

	private readonly runner: TmuxRunner;
	private readonly sendKeysDelayMs: number;

	constructor(options: TmuxBackendOptions = {}) {
		this.runner = options.runner ?? defaultTmuxRunner();
		this.sendKeysDelayMs = options.sendKeysDelayMs ?? 200;
	}

	sessionNameFor(task_id: string): string {
		return `cuekit-task-${task_id}`;
	}

	async spawnPane(params: SpawnPaneParams): Promise<PaneHandle> {
		const sessionName = this.sessionNameFor(params.task_id);
		const envArgs = Object.entries(params.env ?? {}).flatMap(([key, value]) => {
			if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
				throw new Error(`invalid tmux environment key '${key}'`);
			}
			return ["-e", `${key}=${value}`];
		});
		const result = await this.runner.run([
			"new-session",
			"-d",
			"-s",
			sessionName,
			...envArgs,
			"-c",
			params.cwd,
			"-P",
			"-F",
			"#{pane_id}",
			params.command,
		]);
		if (result.exitCode !== 0) {
			throw new Error(
				`tmux new-session for task ${params.task_id} failed (exit ${result.exitCode}): ${result.stderr.trim()}`,
			);
		}
		const backend_pane_id = result.stdout.trim();
		if (!backend_pane_id) {
			throw new Error(`tmux new-session for task ${params.task_id} did not report a pane id`);
		}

		if (params.transcriptPath) {
			const pipeResult = await this.runner.run([
				"pipe-pane",
				"-t",
				backend_pane_id,
				"-o",
				`cat > ${shellQuote(params.transcriptPath)}`,
			]);
			if (pipeResult.exitCode !== 0) {
				try {
					await this.killPane(params.task_id);
				} catch {
					// Preserve the original pipe-pane failure; cleanup is best-effort here.
				}
				throw new Error(
					`tmux pipe-pane for task ${params.task_id} failed: ${pipeResult.stderr.trim()}`,
				);
			}
		}

		return {
			task_id: params.task_id,
			backend_kind: this.kind,
			backend_session: sessionName,
			backend_pane_id,
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

	async capturePane(task_id: string, opts: CaptureOptions = {}): Promise<string | null> {
		const target = this.sessionNameFor(task_id);
		const scrollback = opts.scrollbackLines ?? DEFAULT_CAPTURE_SCROLLBACK;
		const result = await this.runner.run([
			"capture-pane",
			"-p",
			"-J",
			"-e",
			"-S",
			`-${scrollback}`,
			"-t",
			target,
		]);
		if (result.exitCode !== 0) {
			return null;
		}
		return result.stdout;
	}

	async killPane(task_id: string): Promise<void> {
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

	attachCommand(task_id: string): { argv: string[] } | null {
		return { argv: ["tmux", "attach-session", "-t", this.sessionNameFor(task_id)] };
	}
}

/**
 * Backwards-compatible alias retained during the multiplexer-backend
 * abstraction migration. New code should depend on `MultiplexerBackend` (the
 * interface) or `TmuxBackend` (the concrete tmux implementation).
 *
 * Removal is filed as Phase 5 (issue #424).
 */
export const PaneBackend = TmuxBackend;
export type PaneBackend = TmuxBackend;
