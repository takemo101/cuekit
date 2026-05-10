import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	CaptureOptions,
	MultiplexerBackend,
	PaneHandle,
	SpawnPaneParams,
} from "./multiplexer-backend.ts";
import { defaultZellijRunner, type ZellijRunner } from "./zellij-runner.ts";

export interface ZellijBackendOptions {
	runner?: ZellijRunner;
	// Delay between `write-chars` and the synthetic Enter (zellij `write 13`).
	// Mirrors TmuxBackend's send-keys cadence so steering behaves consistently.
	sendKeysDelayMs?: number;
}

/**
 * Zellij implementation of MultiplexerBackend. Phase 3 baseline: one task
 * per zellij session named `cuekit-task-<task_id>`. Phase 4 (#418) extends
 * this with team-session sharing.
 *
 * CLI forms (verified against real zellij 0.43.x in spike #410 follow-up;
 * earlier librarian research conflated 0.43 / 0.44 forms — corrected here):
 *   - `zellij attach --create-background <name>` for headless session create
 *   - `zellij --session <name> action new-pane --close-on-exit --cwd <cwd>
 *      -- <cmd>` — note `--cwd` rather than wrapping the command with `cd`.
 *      In 0.43 there is no per-pane stdout-id return (`new-pane` exits 0
 *      with empty stdout when successful), so we generate a synthetic
 *      handle id from the task id.
 *   - `zellij --session <name> action write-chars <text>` then
 *     `action write 13` for steering. Both target the focused pane;
 *     for the Phase 3 1-task-per-session model this is always the worker
 *     pane. Phase 4 will need focus-pane interleaving for multi-pane
 *     sessions.
 *   - `zellij --session <name> action dump-screen --full <path>` for
 *     capture (path is positional, no --pane-id, no --ansi flag).
 *   - `zellij kill-session <name>` (singular) for kill.
 */
export class ZellijBackend implements MultiplexerBackend {
	readonly kind = "zellij";

	private readonly runner: ZellijRunner;
	private readonly sendKeysDelayMs: number;

	constructor(options: ZellijBackendOptions = {}) {
		this.runner = options.runner ?? defaultZellijRunner();
		this.sendKeysDelayMs = options.sendKeysDelayMs ?? 200;
	}

	sessionNameFor(task_id: string): string {
		return `cuekit-task-${task_id}`;
	}

	async spawnPane(params: SpawnPaneParams): Promise<PaneHandle> {
		const sessionName = this.sessionNameFor(params.task_id);

		// Step 1 — create the session in the background so subsequent
		// `--session` action calls have a target.
		const createResult = await this.runner.run([
			"attach",
			"--create-background",
			sessionName,
		]);
		if (createResult.exitCode !== 0) {
			throw new Error(
				`zellij attach --create-background for task ${params.task_id} failed (exit ${createResult.exitCode}): ${createResult.stderr.trim()}`,
			);
		}

		// Step 2 — spawn the command into a new pane in that session.
		// `--close-on-exit` removes the pane when the command exits, matching
		// tmux's session-dies-when-process-exits semantics for solo tasks.
		// Validate env keys before serialising so callers see the same
		// invalid-key error tmux raises.
		for (const key of Object.keys(params.env ?? {})) {
			if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
				throw new Error(`invalid zellij environment key '${key}'`);
			}
		}
		const envPrefix =
			Object.entries(params.env ?? {})
				.map(([key, value]) => `${key}=${shellQuote(value)}`)
				.join(" ");
		const wrappedCommand = envPrefix.length > 0 ? `env ${envPrefix} ${params.command}` : params.command;

		const spawnResult = await this.runner.run([
			"--session",
			sessionName,
			"action",
			"new-pane",
			"--close-on-exit",
			"--cwd",
			params.cwd,
			"--",
			"sh",
			"-c",
			wrappedCommand,
		]);
		if (spawnResult.exitCode !== 0) {
			// Best-effort: tear down the session we just created so a retry
			// doesn't trip over an orphan.
			try {
				await this.runner.run(["kill-session", sessionName]);
			} catch {
				// preserve the original failure
			}
			throw new Error(
				`zellij action new-pane for task ${params.task_id} failed (exit ${spawnResult.exitCode}): ${spawnResult.stderr.trim()}`,
			);
		}

		// zellij 0.43 doesn't print a runtime pane id from new-pane. We
		// don't strictly need one for the Phase 3 model (steering / capture
		// target the focused pane in the session, which is always the
		// worker we just spawned). Surface a synthetic id for downstream
		// metadata so PaneHandle.backend_pane_id is non-empty.
		const backend_pane_id = `${sessionName}/pane`;

		return {
			task_id: params.task_id,
			backend_kind: this.kind,
			backend_session: sessionName,
			backend_pane_id,
		};
	}

	async isAlive(task_id: string): Promise<boolean> {
		// Zellij doesn't have a tmux `has-session` analogue; list-sessions is
		// the closest. The output is ANSI-coloured (session names are wrapped
		// in escape sequences), so strip control characters before
		// pattern-matching.
		const result = await this.runner.run(["list-sessions"]);
		if (result.exitCode !== 0) return false;
		const sessionName = this.sessionNameFor(task_id);
		const stripped = result.stdout.replace(/\[[0-9;]*m/g, "");
		const pattern = new RegExp(`(^|\\s)${escapeRegExp(sessionName)}(\\s|$|\\[)`);
		return pattern.test(stripped);
	}

	async sendKeys(task_id: string, message: string): Promise<void> {
		const target = this.sessionNameFor(task_id);
		const literal = await this.runner.run([
			"--session",
			target,
			"action",
			"write-chars",
			message,
		]);
		if (literal.exitCode !== 0) {
			throw new Error(`zellij write-chars for task ${task_id} failed: ${literal.stderr.trim()}`);
		}
		if (this.sendKeysDelayMs > 0) {
			await Bun.sleep(this.sendKeysDelayMs);
		}
		const enter = await this.runner.run([
			"--session",
			target,
			"action",
			"write",
			"13",
		]);
		if (enter.exitCode !== 0) {
			throw new Error(`zellij write Enter for task ${task_id} failed: ${enter.stderr.trim()}`);
		}
	}

	async capturePane(task_id: string, opts: CaptureOptions = {}): Promise<string | null> {
		const target = this.sessionNameFor(task_id);
		// dump-screen takes a path positional and writes the focused pane's
		// content there. Allocate a temp dir per call; clean up after read.
		const dir = await mkdtemp(join(tmpdir(), "cuekit-zellij-"));
		const tmpPath = join(dir, "dump.txt");
		try {
			void opts;
			const result = await this.runner.run([
				"--session",
				target,
				"action",
				"dump-screen",
				"--full",
				tmpPath,
			]);
			if (result.exitCode !== 0) return null;
			try {
				return await readFile(tmpPath, "utf8");
			} catch {
				return null;
			}
		} finally {
			await rm(dir, { recursive: true, force: true }).catch(() => {});
		}
	}

	async killPane(task_id: string): Promise<void> {
		const target = this.sessionNameFor(task_id);
		// Phase 3 model is one session per task, so killing the whole session
		// is the simplest mapping. Phase 4 (#420) will use close-pane on a
		// shared team session instead.
		const result = await this.runner.run(["kill-session", target]);
		const errText = `${result.stderr} ${result.stdout}`.toLowerCase();
		if (
			result.exitCode !== 0 &&
			!/no session named|no such session|session.*not found|does not exist|not running/.test(errText)
		) {
			throw new Error(`zellij kill-session for task ${task_id} failed: ${result.stderr.trim()}`);
		}
	}

	attachCommand(task_id: string): { argv: string[] } | null {
		return { argv: ["zellij", "attach", this.sessionNameFor(task_id)] };
	}
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function shellQuote(value: string): string {
	if (/^[A-Za-z0-9_./=:-]+$/.test(value)) return value;
	return `'${value.replace(/'/g, `'\\''`)}'`;
}
