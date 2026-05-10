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
	// zellij 0.44 can return from `attach --create-background` before the
	// layout-created pane appears in `list-panes`. Treat a missing pane as
	// alive during this short startup window to avoid false failure inference.
	paneMissingGraceMs?: number;
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
	private readonly paneMissingGraceMs: number;
	private readonly taskHandles = new Map<
		string,
		{ session: string; paneId?: string; teamId?: string; label?: string }
	>();
	private readonly teamLocks = new Map<string, Promise<PaneHandle>>();
	private versionCheckedForTeam = false;

	constructor(options: ZellijBackendOptions = {}) {
		this.runner = options.runner ?? defaultZellijRunner();
		this.sendKeysDelayMs = options.sendKeysDelayMs ?? 200;
		this.paneMissingGraceMs = options.paneMissingGraceMs ?? 15_000;
	}

	sessionNameFor(task_id: string): string {
		const existing = this.taskHandles.get(task_id);
		if (existing) return existing.session;
		// zellij stores session sockets under a platform temp dir and enforces
		// the Unix socket path limit. Keep names compact so normal cuekit task ids
		// do not trip "socket path should not be longer than 104 bytes" on macOS.
		return `ct-${task_id}`;
	}

	restorePaneHandle(handle: PaneHandle): void {
		if (handle.backend_kind !== this.kind) return;
		const displayRef = handle.backend_pane_id ?? "";
		const separator = displayRef.indexOf("/");
		const session =
			handle.backend_session ?? (separator > 0 ? displayRef.slice(0, separator) : undefined);
		const paneId = separator > 0 ? displayRef.slice(separator + 1) : displayRef;
		if (!session) return;
		this.taskHandles.set(handle.task_id, {
			session,
			...(paneId ? { paneId } : {}),
			...(handle.backend_label ? { label: handle.backend_label } : {}),
		});
	}

	private teamSessionNameFor(team_id: string): string {
		return `ctm-${team_id.replace(/^tm_/, "")}`;
	}

	async spawnPane(params: SpawnPaneParams): Promise<PaneHandle> {
		if (params.team_id) {
			const previous = this.teamLocks.get(params.team_id) ?? Promise.resolve(undefined as never);
			const next = previous.catch(() => undefined).then(() => this.spawnTeamPane(params));
			this.teamLocks.set(params.team_id, next);
			try {
				return await next;
			} finally {
				if (this.teamLocks.get(params.team_id) === next) this.teamLocks.delete(params.team_id);
			}
		}
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
		const layoutPath = join(scriptDir, "task.kdl");
		await writeFile(layoutPath, renderTaskLayout(layoutCommand, layoutCommandArgs, params.cwd));
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
		this.taskHandles.set(params.task_id, { session: sessionName, paneId: "pane" });

		return {
			task_id: params.task_id,
			backend_kind: this.kind,
			backend_session: sessionName,
			backend_pane_id,
		};
	}

	private async ensureTeamPaneSupport(): Promise<void> {
		if (this.versionCheckedForTeam) return;
		const result = await this.runner.run(["--version"]);
		if (result.exitCode !== 0) {
			throw new Error(
				`zellij >= 0.44.2 is required for team sessions; version check failed: ${result.stderr.trim()}`,
			);
		}
		const version = parseZellijVersion(result.stdout);
		if (!version || compareVersions(version, [0, 44, 2]) < 0) {
			throw new Error(
				`zellij >= 0.44.2 is required for team sessions; found ${result.stdout.trim() || "unknown"}`,
			);
		}
		this.versionCheckedForTeam = true;
	}

	private async spawnTeamPane(params: SpawnPaneParams): Promise<PaneHandle> {
		await this.ensureTeamPaneSupport();
		const teamId = params.team_id as string;
		const sessionName = this.teamSessionNameFor(teamId);
		const paneName = params.team_position
			? `${params.team_position}:${params.task_id}`
			: params.task_id;
		const launch = await this.prepareLaunch(params);
		const exists = await this.sessionExists(sessionName);
		let paneId = "terminal_0";

		if (!exists) {
			const layoutPath = join(launch.scriptDir, "task.kdl");
			await writeFile(
				layoutPath,
				renderTeamLayout(paneName, launch.command, launch.args, params.cwd),
			);
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
			if (createResult.exitCode !== 0) {
				await rm(launch.scriptDir, { recursive: true, force: true }).catch(() => {});
				throw new Error(
					`zellij attach --create-background for team ${teamId} failed (exit ${createResult.exitCode}): ${createResult.stderr.trim()}`,
				);
			}
		} else {
			const createPane = await this.runner.run([
				"--session",
				sessionName,
				"action",
				"new-pane",
				"-n",
				paneName,
				"--cwd",
				params.cwd,
				"--",
				launch.command,
				...launch.args,
			]);
			if (createPane.exitCode !== 0) {
				await rm(launch.scriptDir, { recursive: true, force: true }).catch(() => {});
				throw new Error(
					`zellij new-pane for team task ${params.task_id} failed (exit ${createPane.exitCode}): ${createPane.stderr.trim()}`,
				);
			}
			paneId = createPane.stdout.trim();
			if (!/^terminal_\d+$/.test(paneId)) {
				await rm(launch.scriptDir, { recursive: true, force: true }).catch(() => {});
				throw new Error(
					`zellij new-pane for team task ${params.task_id} did not report a terminal pane id`,
				);
			}
		}

		this.taskHandles.set(params.task_id, { session: sessionName, paneId, teamId, label: paneName });
		return {
			task_id: params.task_id,
			backend_kind: this.kind,
			backend_session: sessionName,
			backend_pane_id: `${sessionName}/${paneId}`,
			backend_label: paneName,
		};
	}

	private async prepareLaunch(
		params: SpawnPaneParams,
	): Promise<{ command: string; args: string[]; scriptDir: string }> {
		for (const key of Object.keys(params.env ?? {})) {
			if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
				throw new Error(`invalid zellij environment key '${key}'`);
			}
		}
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
		const useScriptTranscript = Boolean(params.transcriptPath && !params.preserveNativeTty);
		return useScriptTranscript
			? {
					command: "script",
					args: scriptArgsFor(params.transcriptPath as string, launchScriptPath),
					scriptDir,
				}
			: { command: "sh", args: [launchScriptPath], scriptDir };
	}

	private async sessionExists(sessionName: string): Promise<boolean> {
		const result = await this.runner.run(["list-sessions"]);
		if (result.exitCode !== 0) return false;
		const ansiEscapePattern = "\\x1b\\[[0-9;]*m";
		const stripped = result.stdout.replace(new RegExp(ansiEscapePattern, "g"), "");
		const pattern = new RegExp(`(^|\\s)${escapeRegExp(sessionName)}(\\s|$|\\[)`);
		const sessionAlive = stripped
			.split("\n")
			.some((line) => pattern.test(line) && !/\bEXITED\b/.test(line));
		return sessionAlive;
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
		const sessionAlive = stripped
			.split("\n")
			.some((line) => pattern.test(line) && !/\bEXITED\b/.test(line));
		if (!sessionAlive) return false;

		const paneId = this.taskHandles.get(task_id)?.paneId;
		if (!paneId || !/^terminal_\d+$/.test(paneId)) return true;
		const pane = await this.findPane(sessionName, paneId);
		if (pane) return pane.exited !== true;
		if (this.paneMissingGraceMs <= 0) return false;

		const deadline = Date.now() + this.paneMissingGraceMs;
		while (Date.now() < deadline) {
			await Bun.sleep(250);
			const retryPane = await this.findPane(sessionName, paneId);
			if (retryPane) return retryPane.exited !== true;
		}
		return false;
	}

	private async findPane(
		sessionName: string,
		paneId: string,
	): Promise<{ id?: number; exited?: boolean } | null> {
		const panes = await this.runner.run([
			"--session",
			sessionName,
			"action",
			"list-panes",
			"--json",
			"--all",
			"--state",
		]);
		if (panes.exitCode !== 0) return null;
		const targetId = Number.parseInt(paneId.replace(/^terminal_/, ""), 10);
		try {
			const parsed = JSON.parse(panes.stdout) as Array<{ id?: number; exited?: boolean }>;
			return parsed.find((entry) => entry.id === targetId) ?? null;
		} catch {
			return { id: targetId, exited: false };
		}
	}

	async sendKeys(task_id: string, message: string): Promise<void> {
		const target = this.sessionNameFor(task_id);
		const paneId = this.taskHandles.get(task_id)?.paneId;
		const paneArgs = paneId && /^terminal_\d+$/.test(paneId) ? ["-p", paneId] : [];
		const literal = await this.runner.run([
			"--session",
			target,
			"action",
			"write-chars",
			...paneArgs,
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
			...paneArgs,
			"13",
		]);
		if (enter.exitCode !== 0) {
			throw new Error(`zellij write Enter for task ${task_id} failed: ${enter.stderr.trim()}`);
		}
	}

	async capturePane(task_id: string, opts: CaptureOptions = {}): Promise<string | null> {
		const target = this.sessionNameFor(task_id);
		const paneId = this.taskHandles.get(task_id)?.paneId;
		// dump-screen takes a path positional and writes the focused pane's
		// content there. Allocate a temp dir per call; clean up after read.
		const dir = await mkdtemp(join(tmpdir(), "cuekit-zellij-"));
		const tmpPath = join(dir, "dump.txt");
		try {
			void opts;
			const result =
				paneId && /^terminal_\d+$/.test(paneId)
					? await this.runner.run([
							"--session",
							target,
							"action",
							"dump-screen",
							"-p",
							paneId,
							"--full",
							"--path",
							tmpPath,
						])
					: await this.runner.run([
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
		const paneId = this.taskHandles.get(task_id)?.paneId;
		if (paneId && /^terminal_\d+$/.test(paneId)) {
			const result = await this.runner.run([
				"--session",
				target,
				"action",
				"close-pane",
				"-p",
				paneId,
			]);
			this.taskHandles.delete(task_id);
			if (
				result.exitCode !== 0 &&
				!/no such pane|pane not found|no such session|not found/i.test(result.stderr)
			) {
				throw new Error(`zellij close-pane for task ${task_id} failed: ${result.stderr.trim()}`);
			}
			return;
		}
		// Phase 3 model is one session per task, so killing the whole session
		// is the simplest mapping. Phase 4 (#420) will use close-pane on a
		// shared team session instead. zellij can leave exited sessions in a
		// resurrectable list; delete-session is the cleanup path for those.
		const result = await this.runner.run(["kill-session", target]);
		const errText = `${result.stderr} ${result.stdout}`.toLowerCase();
		if (result.exitCode === 0) {
			await this.deleteSession(target, `task ${task_id}`);
			return;
		}
		const missing =
			/no session named|no such session|session.*not found|does not exist|not running/.test(
				errText,
			);
		if (missing) {
			await this.deleteSession(target, `task ${task_id}`);
			return;
		}
		throw new Error(`zellij kill-session for task ${task_id} failed: ${result.stderr.trim()}`);
	}

	private async deleteSession(sessionName: string, label: string): Promise<void> {
		const deleted = await this.runner.run(["delete-session", sessionName]);
		const deleteText = `${deleted.stderr} ${deleted.stdout}`.toLowerCase();
		if (
			deleted.exitCode !== 0 &&
			!/no session named|no such session|session.*not found|does not exist|not running/.test(
				deleteText,
			)
		) {
			throw new Error(`zellij delete-session for ${label} failed: ${deleted.stderr.trim()}`);
		}
	}

	async markPaneTerminal(task_id: string, status: string): Promise<void> {
		const handle = this.taskHandles.get(task_id);
		const paneId = handle?.paneId;
		if (!handle || !paneId || !/^terminal_\d+$/.test(paneId)) return;
		const label = handle.label ?? task_id;
		const result = await this.runner.run([
			"--session",
			handle.session,
			"action",
			"rename-pane",
			"-p",
			paneId,
			`${label} [${status}]`,
		]);
		if (
			result.exitCode !== 0 &&
			!/no such pane|pane not found|no such session|not found/i.test(result.stderr)
		) {
			throw new Error(`zellij rename-pane for task ${task_id} failed: ${result.stderr.trim()}`);
		}
	}

	async killTeamSession(team_id: string): Promise<void> {
		const sessionName = this.teamSessionNameFor(team_id);
		const result = await this.runner.run(["kill-session", sessionName]);
		const errText = `${result.stderr} ${result.stdout}`.toLowerCase();
		if (result.exitCode === 0) {
			await this.deleteSession(sessionName, `team ${team_id}`);
			return;
		}
		const missing =
			/no session named|no such session|session.*not found|does not exist|not running/.test(
				errText,
			);
		if (missing) {
			await this.deleteSession(sessionName, `team ${team_id}`);
			return;
		}
		throw new Error(`zellij kill-session for team ${team_id} failed: ${result.stderr.trim()}`);
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

function parseZellijVersion(output: string): [number, number, number] | null {
	const match = output.match(/zellij\s+(\d+)\.(\d+)\.(\d+)/i);
	if (!match) return null;
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersions(left: [number, number, number], right: [number, number, number]): number {
	for (const index of [0, 1, 2] as const) {
		const diff = left[index] - right[index];
		if (diff !== 0) return diff;
	}
	return 0;
}

function renderTaskLayout(command: string, args = ["-c", command], cwd?: string): string {
	const renderedArgs = args.map((arg) => ` "${escapeKdlString(arg)}"`).join("");
	const renderedCwd = cwd ? ` cwd="${escapeKdlString(cwd)}"` : "";
	return `layout {
  pane command="${escapeKdlString(command)}"${renderedCwd} close_on_exit=true {
    args${renderedArgs}
  }
}
`;
}

function renderTeamLayout(name: string, command: string, args: string[], cwd: string): string {
	const renderedArgs = args.map((arg) => ` "${escapeKdlString(arg)}"`).join("");
	return `layout {
  pane name="${escapeKdlString(name)}" cwd="${escapeKdlString(cwd)}" command="${escapeKdlString(command)}" {
    args${renderedArgs}
  }

  swap_tiled_layout name="cuekit-dashboard" {
    tab max_panes=2 {
      pane split_direction="vertical" {
        pane
        pane
      }
    }
    tab max_panes=4 {
      pane {
        pane split_direction="vertical" {
          pane
          pane
        }
        pane split_direction="vertical" {
          pane
          pane
        }
      }
    }
    tab {
      pane split_direction="vertical" {
        pane { children; }
        pane {
          pane
          pane
          pane
          pane
        }
      }
    }
  }
}
`;
}

function escapeKdlString(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}
