import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
 * per zellij session named `ct-<task_id>`. Phase 4 (#418) extends
 * this with team-session sharing.
 *
 * CLI forms (verified against real zellij 0.43.x in spike #410 follow-up;
 * earlier librarian research conflated 0.43 / 0.44 forms — corrected here):
 *   - `zellij attach --create-background <name> options --default-cwd <cwd>
 *      --default-layout <layout.kdl>` for headless session create with the
 *      task command as the initial pane. We intentionally do not send a
 *      follow-up `action new-pane` because zellij 0.43 cannot apply it
 *      reliably to sessions with no attached clients.
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
		// zellij stores session sockets under a platform temp dir and enforces
		// the Unix socket path limit. Keep names compact so normal cuekit task ids
		// do not trip "socket path should not be longer than 104 bytes" on macOS.
		return `ct-${task_id}`;
	}

	async spawnPane(params: SpawnPaneParams): Promise<PaneHandle> {
		const sessionName = this.sessionNameFor(params.task_id);

		// Validate env keys before serialising so callers see the same
		// invalid-key error tmux raises, and before creating any zellij session.
		for (const key of Object.keys(params.env ?? {})) {
			if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
				throw new Error(`invalid zellij environment key '${key}'`);
			}
		}
		// zellij 0.43 cannot reliably apply `zellij --session <name> action
		// new-pane ...` to a fully detached session: the server tries to place
		// the pane relative to a connected client's active tab, logs "No client
		// ids in screen found", and the CLI exits successfully without a worker
		// pane. Start the task as the initial layout pane instead. With
		// `close_on_exit=true`, the session disappears when the task command
		// exits, matching tmux's per-task-session lifecycle.
		const layoutDir = await mkdtemp(join(tmpdir(), "cuekit-zellij-layout-"));
		const scriptDir = await mkdtemp(join(tmpdir(), "cuekit-zellij-launch-"));
		const envScriptPath = join(scriptDir, "env.sh");
		const envExports = Object.entries(params.env ?? {})
			.map(([key, value]) => `export ${key}=${shellQuote(value)}`)
			.join("\n");
		await writeFile(envScriptPath, `${envExports}\n`);
		await chmod(envScriptPath, 0o600);
		const launchScriptPath = join(scriptDir, "launch.sh");
		await writeFile(
			launchScriptPath,
			`#!/bin/sh\ntrap 'rm -rf ${shellQuote(scriptDir)}' EXIT HUP INT TERM\n. ${shellQuote(envScriptPath)}\nprintf '[cuekit] zellij task started: %s\\n' ${shellQuote(params.task_id)}\n${params.command}\nstatus=$?\nprintf '[cuekit] zellij task launcher exited: %s\\n' "$status"\nexit "$status"\n`,
		);
		await chmod(launchScriptPath, 0o600);
		// Use a temporary launch script instead of embedding the full prompt in KDL.
		// Batch tasks with a transcript path are wrapped in `script` so stdout/stderr
		// are captured while the child still sees a TTY. Interactive tasks skip
		// `script`: script(1)'s inner pty starts at zellij's headless default size
		// and does not reliably propagate later attach resizes, making full-width
		// TUIs render in a narrow 80-column box.
		// Child-reporting secrets live in a 0600 temp env file, not KDL or argv.
		const useScriptTranscript = Boolean(params.transcriptPath && !params.preserveNativeTty);
		const layoutCommand = useScriptTranscript ? "script" : "sh";
		const layoutCommandArgs = useScriptTranscript
			? scriptArgsFor(params.transcriptPath as string, launchScriptPath)
			: [launchScriptPath];
		const layoutPath = join(layoutDir, "task.kdl");
		await writeFile(layoutPath, renderTaskLayout(layoutCommand, layoutCommandArgs));
		const createResult = await this.runner.run([
			"attach",
			"--create-background",
			sessionName,
			"options",
			"--default-cwd",
			params.cwd,
			"--default-layout",
			layoutPath,
		]);
		await rm(layoutDir, { recursive: true, force: true }).catch(() => {});
		if (createResult.exitCode !== 0) {
			await rm(scriptDir, { recursive: true, force: true }).catch(() => {});
			throw new Error(
				`zellij attach --create-background for task ${params.task_id} failed (exit ${createResult.exitCode}): ${createResult.stderr.trim()}`,
			);
		}

		// zellij 0.43 doesn't print a runtime pane id from layout-created panes.
		// We don't strictly need one for the Phase 3 model (steering / capture
		// target the focused pane in the per-task session). Surface a synthetic
		// id for downstream metadata so PaneHandle.backend_pane_id is non-empty.
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
		const ansiEscapePattern = "\\x1b\\[[0-9;]*m";
		const stripped = result.stdout.replace(new RegExp(ansiEscapePattern, "g"), "");
		const pattern = new RegExp(`(^|\\s)${escapeRegExp(sessionName)}(\\s|$|\\[)`);
		return stripped.split("\n").some((line) => pattern.test(line) && !/\bEXITED\b/.test(line));
	}

	async sendKeys(task_id: string, message: string): Promise<void> {
		const target = this.sessionNameFor(task_id);
		const literal = await this.runner.run(["--session", target, "action", "write-chars", message]);
		if (literal.exitCode !== 0) {
			throw new Error(`zellij write-chars for task ${task_id} failed: ${literal.stderr.trim()}`);
		}
		if (this.sendKeysDelayMs > 0) {
			await Bun.sleep(this.sendKeysDelayMs);
		}
		const enter = await this.runner.run(["--session", target, "action", "write", "13"]);
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
		// shared team session instead. zellij can leave exited sessions in a
		// resurrectable list; delete-session is the cleanup path for those.
		const result = await this.runner.run(["kill-session", target]);
		const errText = `${result.stderr} ${result.stdout}`.toLowerCase();
		if (result.exitCode === 0) return;
		const missing =
			/no session named|no such session|session.*not found|does not exist|not running/.test(
				errText,
			);
		if (missing) {
			const deleted = await this.runner.run(["delete-session", target]);
			const deleteText = `${deleted.stderr} ${deleted.stdout}`.toLowerCase();
			if (
				deleted.exitCode !== 0 &&
				!/no session named|no such session|session.*not found|does not exist|not running/.test(
					deleteText,
				)
			) {
				throw new Error(
					`zellij delete-session for task ${task_id} failed: ${deleted.stderr.trim()}`,
				);
			}
			return;
		}
		throw new Error(`zellij kill-session for task ${task_id} failed: ${result.stderr.trim()}`);
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

function scriptArgsFor(transcriptPath: string, launchScriptPath: string): string[] {
	if (process.platform === "darwin") {
		return ["-q", transcriptPath, "sh", launchScriptPath];
	}
	return ["-q", "-c", `sh ${shellQuote(launchScriptPath)}`, transcriptPath];
}

function renderTaskLayout(command: string, args = ["-c", command]): string {
	const renderedArgs = args.map((arg) => ` "${escapeKdlString(arg)}"`).join("");
	return `layout {
  pane command="${escapeKdlString(command)}" close_on_exit=true {
    args${renderedArgs}
  }
}
`;
}

function escapeKdlString(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}
