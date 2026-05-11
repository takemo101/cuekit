import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	formatHerdrBackendPaneId,
	type HerdrCoordinate,
	parseHerdrBackendPaneId,
	sanitizeHerdrSessionName,
} from "./herdr-coordinate.ts";
import { defaultHerdrRunner, type HerdrRunner } from "./herdr-runner.ts";
import type {
	CaptureOptions,
	MultiplexerBackend,
	PaneHandle,
	SpawnPaneParams,
} from "./multiplexer-backend.ts";

interface PreparedHerdrCommand {
	command: string;
	cleanup: () => Promise<void>;
}

interface HerdrTaskHandle extends HerdrCoordinate {
	teamId?: string;
	cuekitOwnedWorkspace: boolean;
	label?: string;
}

interface HerdrTeamWorkspace {
	session: string;
	workspaceId: string;
	tabId: string;
	seedPaneId: string;
}

export interface HerdrBackendOptions {
	runner?: HerdrRunner;
	sessionName?: string;
	sendKeysDelayMs?: number;
}

const DEFAULT_CAPTURE_SCROLLBACK = 200;

export class HerdrBackend implements MultiplexerBackend {
	readonly kind = "herdr";

	private readonly runner: HerdrRunner;
	private readonly sessionName: string;
	private readonly sendKeysDelayMs: number;
	private readonly taskHandles = new Map<string, HerdrTaskHandle>();
	private readonly teamWorkspaces = new Map<string, HerdrTeamWorkspace>();

	constructor(options: HerdrBackendOptions = {}) {
		this.runner = options.runner ?? defaultHerdrRunner();
		this.sessionName = sanitizeHerdrSessionName(options.sessionName ?? "ck-cuekit");
		this.sendKeysDelayMs = options.sendKeysDelayMs ?? 200;
	}

	sessionNameFor(_task_id: string): string {
		return this.sessionName;
	}

	async spawnPane(params: SpawnPaneParams): Promise<PaneHandle> {
		for (const key of Object.keys(params.env ?? {})) {
			if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
				throw new Error(`invalid herdr environment key '${key}'`);
			}
		}

		const prepared = params.env
			? await this.prepareLaunchCommand(params)
			: { command: params.command, cleanup: async () => {} };
		const label = params.team_id
			? `team:${params.team_id}:${params.team_position ?? "member"}:${params.task_id}`
			: `task ${params.task_id}`;
		const coordinate = params.team_id
			? await this.spawnTeamPane(params, prepared)
			: await this.spawnSoloPane(params, prepared, label);
		const handle: HerdrTaskHandle = {
			...coordinate,
			...(params.team_id ? { teamId: params.team_id } : {}),
			cuekitOwnedWorkspace: !params.team_id,
			label,
		};
		this.taskHandles.set(params.task_id, handle);
		return this.toPaneHandle(params.task_id, handle);
	}

	restorePaneHandle(handle: PaneHandle): void {
		if (handle.backend_kind !== this.kind) return;
		const coordinate = parseHerdrBackendPaneId(handle.backend_session, handle.backend_pane_id);
		if (!coordinate) return;
		const restored = this.restoreTaskHandleMetadata(coordinate, handle.backend_label);
		this.taskHandles.set(handle.task_id, restored);
		if (restored.teamId) {
			this.teamWorkspaces.set(restored.teamId, {
				session: restored.session,
				workspaceId: restored.workspaceId,
				tabId: restored.tabId,
				seedPaneId: restored.paneId,
			});
		}
	}

	async isAlive(task_id: string): Promise<boolean> {
		return (await this.validatedHandle(task_id)) !== null;
	}

	async sendKeys(task_id: string, message: string): Promise<void> {
		const handle = await this.requireValidatedHandle(task_id);
		await this.runner.sendInput({
			session: handle.session,
			paneId: handle.paneId,
			text: message,
			keys: ["Enter"],
		});
		if (this.sendKeysDelayMs > 0) await Bun.sleep(this.sendKeysDelayMs);
	}

	async capturePane(task_id: string, opts: CaptureOptions = {}): Promise<string | null> {
		const handle = await this.validatedHandle(task_id);
		if (!handle) return null;
		const result = await this.runner.readPane({
			session: handle.session,
			paneId: handle.paneId,
			source: "recent",
			lines: opts.scrollbackLines ?? DEFAULT_CAPTURE_SCROLLBACK,
		});
		return result.text;
	}

	async killPane(task_id: string): Promise<void> {
		const handle = this.taskHandles.get(task_id);
		if (!handle) return;
		if (handle.cuekitOwnedWorkspace && !handle.teamId) {
			await this.runner.closeWorkspace({
				session: handle.session,
				workspaceId: handle.workspaceId,
			});
		} else {
			await this.runner.closePane({ session: handle.session, paneId: handle.paneId });
		}
		this.taskHandles.delete(task_id);
	}

	attachCommand(_task_id: string): { argv: string[] } | null {
		return { argv: ["herdr", "--session", this.sessionName] };
	}

	async killTeamSession(team_id: string): Promise<void> {
		const workspace =
			this.teamWorkspaces.get(team_id) ?? this.restoreTeamWorkspaceFromHandles(team_id);
		if (!workspace) return;
		await this.runner.closeWorkspace({
			session: workspace.session,
			workspaceId: workspace.workspaceId,
		});
		this.teamWorkspaces.delete(team_id);
		for (const [taskId, handle] of this.taskHandles.entries()) {
			if (handle.teamId === team_id) this.taskHandles.delete(taskId);
		}
	}

	private async spawnSoloPane(
		params: SpawnPaneParams,
		prepared: PreparedHerdrCommand,
		label: string,
	): Promise<HerdrCoordinate> {
		const created = await this.runner.createWorkspace({
			session: this.sessionName,
			cwd: params.cwd,
			label,
		});
		try {
			await this.runner.runInPane({
				session: this.sessionName,
				paneId: created.root_pane_id,
				command: prepared.command,
			});
		} catch (error) {
			await this.runner
				.closeWorkspace({ session: this.sessionName, workspaceId: created.workspace_id })
				.catch(() => {});
			await prepared.cleanup();
			throw error;
		}
		return {
			session: this.sessionName,
			workspaceId: created.workspace_id,
			tabId: created.tab_id,
			paneId: created.root_pane_id,
		};
	}

	private async spawnTeamPane(
		params: SpawnPaneParams,
		prepared: PreparedHerdrCommand,
	): Promise<HerdrCoordinate> {
		const teamId = params.team_id as string;
		let workspace = this.teamWorkspaces.get(teamId);
		let createdWorkspace = false;
		let paneId: string;
		if (!workspace) {
			const created = await this.runner.createWorkspace({
				session: this.sessionName,
				cwd: params.cwd,
				label: `team ${teamId}`,
			});
			workspace = {
				session: this.sessionName,
				workspaceId: created.workspace_id,
				tabId: created.tab_id,
				seedPaneId: created.root_pane_id,
			};
			this.teamWorkspaces.set(teamId, workspace);
			createdWorkspace = true;
			paneId = created.root_pane_id;
		} else {
			const seedPaneId = await this.liveSeedPane(workspace);
			const pane = await this.runner.splitPane({
				session: workspace.session,
				targetPaneId: seedPaneId,
				direction: "right",
				cwd: params.cwd,
			});
			paneId = pane.pane_id;
			workspace.seedPaneId = paneId;
		}
		try {
			await this.runner.runInPane({
				session: workspace.session,
				paneId,
				command: prepared.command,
			});
		} catch (error) {
			if (createdWorkspace) {
				await this.runner
					.closeWorkspace({ session: workspace.session, workspaceId: workspace.workspaceId })
					.catch(() => {});
				this.teamWorkspaces.delete(teamId);
			} else {
				await this.runner.closePane({ session: workspace.session, paneId }).catch(() => {});
			}
			await prepared.cleanup();
			throw error;
		}
		return {
			session: workspace.session,
			workspaceId: workspace.workspaceId,
			tabId: workspace.tabId,
			paneId,
		};
	}

	private async liveSeedPane(workspace: HerdrTeamWorkspace): Promise<string> {
		try {
			const pane = await this.runner.getPane({
				session: workspace.session,
				paneId: workspace.seedPaneId,
			});
			if (pane.workspace_id === workspace.workspaceId && pane.tab_id === workspace.tabId) {
				return pane.pane_id;
			}
		} catch {
			// Find another pane below.
		}
		const panes = await this.runner.listPanes({
			session: workspace.session,
			workspaceId: workspace.workspaceId,
		});
		const candidate = panes.find((pane) => pane.tab_id === workspace.tabId);
		if (!candidate)
			throw new Error(`no live herdr panes remain for team workspace ${workspace.workspaceId}`);
		workspace.seedPaneId = candidate.pane_id;
		return candidate.pane_id;
	}

	private restoreTaskHandleMetadata(
		coordinate: HerdrCoordinate,
		label: string | undefined,
	): HerdrTaskHandle {
		const teamMatch = label?.match(/^team:([^:]+):/);
		return {
			...coordinate,
			...(teamMatch ? { teamId: teamMatch[1] } : {}),
			cuekitOwnedWorkspace: !teamMatch,
			...(label ? { label } : {}),
		};
	}

	private restoreTeamWorkspaceFromHandles(teamId: string): HerdrTeamWorkspace | undefined {
		const handle = [...this.taskHandles.values()].find((candidate) => candidate.teamId === teamId);
		if (!handle) return undefined;
		const workspace = {
			session: handle.session,
			workspaceId: handle.workspaceId,
			tabId: handle.tabId,
			seedPaneId: handle.paneId,
		};
		this.teamWorkspaces.set(teamId, workspace);
		return workspace;
	}

	private async validatedHandle(task_id: string): Promise<HerdrTaskHandle | null> {
		const handle = this.taskHandles.get(task_id);
		if (!handle) return null;
		try {
			const pane = await this.runner.getPane({ session: handle.session, paneId: handle.paneId });
			if (pane.workspace_id !== handle.workspaceId || pane.tab_id !== handle.tabId) return null;
			return handle;
		} catch {
			return null;
		}
	}

	private async requireValidatedHandle(task_id: string): Promise<HerdrTaskHandle> {
		const handle = await this.validatedHandle(task_id);
		if (!handle)
			throw new Error(`herdr pane for task ${task_id} is not alive or coordinate mismatch`);
		return handle;
	}

	private toPaneHandle(task_id: string, handle: HerdrTaskHandle): PaneHandle {
		return {
			task_id,
			backend_kind: this.kind,
			backend_session: handle.session,
			backend_pane_id: formatHerdrBackendPaneId(handle),
			...(handle.label ? { backend_label: handle.label } : {}),
		};
	}

	private async prepareLaunchCommand(params: SpawnPaneParams): Promise<PreparedHerdrCommand> {
		const scriptDir = await mkdtemp(join(tmpdir(), "cuekit-herdr-launch-"));
		const envScriptPath = join(scriptDir, "env.sh");
		const envExports = Object.entries(params.env ?? {})
			.map(([key, value]) => `export ${key}=${shellQuote(value)}`)
			.join("\n");
		await writeFile(envScriptPath, `${envExports}\n`, { mode: 0o600 });
		const launchScriptPath = join(scriptDir, "launch.sh");
		await writeFile(
			launchScriptPath,
			`#!/bin/sh\ntrap 'rm -rf ${shellQuote(scriptDir)}' EXIT HUP INT TERM\n. ${shellQuote(envScriptPath)}\nprintf '[cuekit] herdr task started: %s\\n' ${shellQuote(params.task_id)}\n${params.command}\nstatus=$?\nprintf '[cuekit] herdr task launcher exited: %s\\n' "$status"\nexit "$status"\n`,
			{ mode: 0o700 },
		);
		return {
			command: `sh ${shellQuote(launchScriptPath)}`,
			cleanup: async () => {
				await rm(scriptDir, { recursive: true, force: true }).catch(() => {});
			},
		};
	}
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}
