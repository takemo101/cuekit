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
	taskId: string;
	teamId?: string;
	teamPosition?: string;
	cuekitOwnedWorkspace: boolean;
	label?: string;
}

interface HerdrPositionTab {
	tabId: string;
	seedPaneId: string;
}

interface HerdrTeamWorkspace {
	session: string;
	workspaceId: string;
	tabId: string;
	seedPaneId: string;
	tabsByPosition: Map<string, HerdrPositionTab>;
}

interface PersistedHerdrTeamWorkspace {
	session: string;
	workspace_id: string;
	tabs_by_position?: Record<string, { tab_id: string; seed_pane_id: string }>;
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
	private readonly teamSpawnLocks = new Map<string, Promise<void>>();

	constructor(options: HerdrBackendOptions = {}) {
		this.runner = options.runner ?? defaultHerdrRunner();
		this.sessionName = sanitizeHerdrSessionName(options.sessionName ?? "ck-cuekit");
		this.sendKeysDelayMs = options.sendKeysDelayMs ?? 200;
	}

	sessionNameFor(task_id: string): string {
		return this.taskHandles.get(task_id)?.session ?? this.sessionName;
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
			? await this.withTeamSpawnLock(params.team_id, () => this.spawnTeamPane(params, prepared))
			: await this.spawnSoloPane(params, prepared, label);
		const handle: HerdrTaskHandle = {
			taskId: params.task_id,
			...coordinate,
			...(params.team_id ? { teamId: params.team_id } : {}),
			...(params.team_id ? { teamPosition: params.team_position ?? "member" } : {}),
			cuekitOwnedWorkspace: !params.team_id,
			label,
		};
		this.taskHandles.set(params.task_id, handle);
		return this.toPaneHandle(params.task_id, handle);
	}

	restoreTeamWorkspaceHandle(team_id: string, handle: unknown): void {
		const restored = parsePersistedHerdrTeamWorkspace(handle);
		if (!restored) return;
		const tabsByPosition = new Map<string, HerdrPositionTab>();
		for (const [position, tab] of Object.entries(restored.tabs_by_position ?? {})) {
			tabsByPosition.set(position, {
				tabId: tab.tab_id,
				seedPaneId: tab.seed_pane_id,
			});
		}
		const firstTab = [...tabsByPosition.values()][0];
		this.teamWorkspaces.set(team_id, {
			session: restored.session,
			workspaceId: restored.workspace_id,
			tabId: firstTab?.tabId ?? "",
			seedPaneId: firstTab?.seedPaneId ?? "",
			tabsByPosition,
		});
	}

	getTeamWorkspaceHandle(team_id: string): unknown | undefined {
		const workspace = this.teamWorkspaces.get(team_id);
		if (!workspace) return undefined;
		return {
			session: workspace.session,
			workspace_id: workspace.workspaceId,
			tabs_by_position: Object.fromEntries(
				[...workspace.tabsByPosition.entries()].map(([position, tab]) => [
					position,
					{ tab_id: tab.tabId, seed_pane_id: tab.seedPaneId },
				]),
			),
		};
	}

	restorePaneHandle(handle: PaneHandle): void {
		if (handle.backend_kind !== this.kind) return;
		const coordinate = parseHerdrBackendPaneId(handle.backend_session, handle.backend_pane_id);
		if (!coordinate) return;
		const restored = this.restoreTaskHandleMetadata(
			handle.task_id,
			coordinate,
			handle.backend_label,
		);
		this.taskHandles.set(handle.task_id, restored);
		if (restored.teamId) {
			const workspace =
				this.teamWorkspaces.get(restored.teamId) ??
				this.createRestoredTeamWorkspace(restored.teamId, restored);
			const position = restored.teamPosition ?? "member";
			workspace.tabsByPosition.set(position, {
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
			await this.closeTeamPane(handle);
		}
		this.taskHandles.delete(task_id);
	}

	attachCommand(task_id: string): { argv: string[] } | null {
		return { argv: ["herdr", "--session", this.sessionNameFor(task_id)] };
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

	private async withTeamSpawnLock<T>(teamId: string, operation: () => Promise<T>): Promise<T> {
		const previous = this.teamSpawnLocks.get(teamId) ?? Promise.resolve();
		const run = previous.catch(() => {}).then(operation);
		const tail = run.then(
			() => {},
			() => {},
		);
		this.teamSpawnLocks.set(teamId, tail);
		try {
			return await run;
		} finally {
			if (this.teamSpawnLocks.get(teamId) === tail) this.teamSpawnLocks.delete(teamId);
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
		const position = params.team_position ?? "member";
		let workspace = this.teamWorkspaces.get(teamId);
		if (workspace && !(await this.teamWorkspaceExists(workspace))) {
			this.teamWorkspaces.delete(teamId);
			workspace = undefined;
		}
		let createdWorkspace = false;
		let createdTab = false;
		let paneId: string;
		let positionTab: HerdrPositionTab;
		if (!workspace) {
			const created = await this.runner.createWorkspace({
				session: this.sessionName,
				cwd: params.cwd,
				label: `team ${teamId}`,
			});
			try {
				await this.runner.renameTab({
					session: this.sessionName,
					tabId: created.tab_id,
					label: position,
				});
			} catch (error) {
				await this.runner
					.closeWorkspace({ session: this.sessionName, workspaceId: created.workspace_id })
					.catch(() => {});
				await prepared.cleanup();
				throw error;
			}
			positionTab = { tabId: created.tab_id, seedPaneId: created.root_pane_id };
			workspace = {
				session: this.sessionName,
				workspaceId: created.workspace_id,
				tabId: created.tab_id,
				seedPaneId: created.root_pane_id,
				tabsByPosition: new Map([[position, positionTab]]),
			};
			this.teamWorkspaces.set(teamId, workspace);
			createdWorkspace = true;
			paneId = created.root_pane_id;
		} else {
			positionTab = workspace.tabsByPosition.get(position) as HerdrPositionTab;
			if (positionTab && !(await this.hasLivePaneInPositionTab(workspace, positionTab))) {
				workspace.tabsByPosition.delete(position);
				positionTab = undefined as unknown as HerdrPositionTab;
			}
			if (!positionTab) {
				const tab = await this.runner.createTab({
					session: workspace.session,
					workspaceId: workspace.workspaceId,
					cwd: params.cwd,
					label: position,
				});
				positionTab = { tabId: tab.tab_id, seedPaneId: tab.root_pane_id };
				workspace.tabsByPosition.set(position, positionTab);
				createdTab = true;
				paneId = tab.root_pane_id;
			} else {
				const seedPaneId = await this.liveSeedPane(workspace, positionTab);
				const pane = await this.runner.splitPane({
					session: workspace.session,
					targetPaneId: seedPaneId,
					direction: "right",
					cwd: params.cwd,
				});
				paneId = pane.pane_id;
				positionTab.seedPaneId = paneId;
				workspace.seedPaneId = paneId;
			}
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
			} else if (createdTab) {
				await this.runner
					.closeTab({ session: workspace.session, tabId: positionTab.tabId })
					.catch(() => {});
				workspace.tabsByPosition.delete(position);
			} else {
				await this.runner.closePane({ session: workspace.session, paneId }).catch(() => {});
			}
			await prepared.cleanup();
			throw error;
		}
		return {
			session: workspace.session,
			workspaceId: workspace.workspaceId,
			tabId: positionTab.tabId,
			paneId,
		};
	}

	private async closeTeamPane(handle: HerdrTaskHandle): Promise<void> {
		const panes = await this.runner.listPanes({
			session: handle.session,
			workspaceId: handle.workspaceId,
		});
		if (panes.length === 0) return;
		const panesInStoredTab = panes.filter((pane) => pane.tab_id === handle.tabId);
		if (panesInStoredTab.length === 0) return;

		const verified = await this.findVerifiedPaneForTask(handle, panesInStoredTab);
		if (verified.pane) {
			await this.runner.closePane({ session: handle.session, paneId: verified.pane.pane_id });
			return;
		}
		if (panesInStoredTab.length === 1 && !verified.foundOtherKnownTask) {
			await this.runner.closePane({
				session: handle.session,
				paneId: panesInStoredTab[0]?.pane_id as string,
			});
			return;
		}
		throw new Error(
			`herdr pane identity for task ${handle.taskId} is ambiguous in tab ${handle.tabId}`,
		);
	}

	private async findVerifiedPaneForTask(
		handle: HerdrTaskHandle,
		panes: Array<{ pane_id: string; tab_id: string; workspace_id: string }>,
	): Promise<{
		pane: { pane_id: string; tab_id: string; workspace_id: string } | null;
		foundOtherKnownTask: boolean;
	}> {
		const matches = [];
		let foundOtherKnownTask = false;
		const otherTaskIds = [...this.taskHandles.values()]
			.filter((candidate) => candidate.taskId !== handle.taskId)
			.map((candidate) => candidate.taskId);
		for (const pane of panes) {
			try {
				const capture = await this.runner.readPane({
					session: handle.session,
					paneId: pane.pane_id,
					source: "recent",
					lines: DEFAULT_CAPTURE_SCROLLBACK,
				});
				if (capture.text.includes(handle.taskId)) matches.push(pane);
				if (otherTaskIds.some((taskId) => capture.text.includes(taskId))) {
					foundOtherKnownTask = true;
				}
			} catch {
				// Treat unreadable panes as unverified.
			}
		}
		return {
			pane:
				matches.length === 1
					? (matches[0] as { pane_id: string; tab_id: string; workspace_id: string })
					: null,
			foundOtherKnownTask,
		};
	}

	private async teamWorkspaceExists(workspace: HerdrTeamWorkspace): Promise<boolean> {
		try {
			const panes = await this.runner.listPanes({
				session: workspace.session,
				workspaceId: workspace.workspaceId,
			});
			return panes.length > 0;
		} catch {
			return false;
		}
	}

	private async hasLivePaneInPositionTab(
		workspace: HerdrTeamWorkspace,
		positionTab: HerdrPositionTab,
	): Promise<boolean> {
		const panes = await this.runner.listPanes({
			session: workspace.session,
			workspaceId: workspace.workspaceId,
		});
		return panes.some((pane) => pane.tab_id === positionTab.tabId);
	}

	private async liveSeedPane(
		workspace: HerdrTeamWorkspace,
		positionTab: HerdrPositionTab,
	): Promise<string> {
		try {
			const pane = await this.runner.getPane({
				session: workspace.session,
				paneId: positionTab.seedPaneId,
			});
			if (pane.workspace_id === workspace.workspaceId && pane.tab_id === positionTab.tabId) {
				return pane.pane_id;
			}
		} catch {
			// Find another pane below.
		}
		const panes = await this.runner.listPanes({
			session: workspace.session,
			workspaceId: workspace.workspaceId,
		});
		const candidate = panes.find((pane) => pane.tab_id === positionTab.tabId);
		if (!candidate) throw new Error(`no live herdr panes remain for team tab ${positionTab.tabId}`);
		positionTab.seedPaneId = candidate.pane_id;
		workspace.seedPaneId = candidate.pane_id;
		return candidate.pane_id;
	}

	private restoreTaskHandleMetadata(
		taskId: string,
		coordinate: HerdrCoordinate,
		label: string | undefined,
	): HerdrTaskHandle {
		const newTeamMatch = label?.match(/^team:([^:]+):([^:]+):/);
		const legacyTeamMatch = newTeamMatch ? null : label?.match(/^team:([^:]+):/);
		const teamId = newTeamMatch?.[1] ?? legacyTeamMatch?.[1];
		const teamPosition = newTeamMatch?.[2] ?? (legacyTeamMatch ? "member" : undefined);
		return {
			taskId,
			...coordinate,
			...(teamId ? { teamId } : {}),
			...(teamPosition ? { teamPosition } : {}),
			cuekitOwnedWorkspace: !teamId,
			...(label ? { label } : {}),
		};
	}

	private createRestoredTeamWorkspace(teamId: string, handle: HerdrTaskHandle): HerdrTeamWorkspace {
		const workspace = {
			session: handle.session,
			workspaceId: handle.workspaceId,
			tabId: handle.tabId,
			seedPaneId: handle.paneId,
			tabsByPosition: new Map<string, HerdrPositionTab>(),
		};
		this.teamWorkspaces.set(teamId, workspace);
		return workspace;
	}

	private restoreTeamWorkspaceFromHandles(teamId: string): HerdrTeamWorkspace | undefined {
		const handle = [...this.taskHandles.values()].find((candidate) => candidate.teamId === teamId);
		if (!handle) return undefined;
		const workspace = this.createRestoredTeamWorkspace(teamId, handle);
		for (const candidate of this.taskHandles.values()) {
			if (candidate.teamId !== teamId) continue;
			workspace.tabsByPosition.set(candidate.teamPosition ?? "member", {
				tabId: candidate.tabId,
				seedPaneId: candidate.paneId,
			});
		}
		return workspace;
	}

	private async validatedHandle(task_id: string): Promise<HerdrTaskHandle | null> {
		const handle = this.taskHandles.get(task_id);
		if (!handle) return null;
		try {
			const pane = await this.runner.getPane({ session: handle.session, paneId: handle.paneId });
			if (pane.workspace_id !== handle.workspaceId || pane.tab_id !== handle.tabId) return null;
			if (handle.teamId) {
				const panes = await this.runner.listPanes({
					session: handle.session,
					workspaceId: handle.workspaceId,
				});
				const panesInTab = panes.filter((candidate) => candidate.tab_id === handle.tabId);
				const verified = await this.findVerifiedPaneForTask(handle, panesInTab);
				if (verified.pane) return verified.pane.pane_id === pane.pane_id ? handle : null;
				if (verified.foundOtherKnownTask) return null;
			}
			return handle;
		} catch {
			if (!handle.teamId) return null;
			const panes = await this.runner.listPanes({
				session: handle.session,
				workspaceId: handle.workspaceId,
			});
			const verified = await this.findVerifiedPaneForTask(
				handle,
				panes.filter((candidate) => candidate.tab_id === handle.tabId),
			);
			if (!verified.pane) return null;
			handle.paneId = verified.pane.pane_id;
			return handle;
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

function parsePersistedHerdrTeamWorkspace(value: unknown): PersistedHerdrTeamWorkspace | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	if (typeof record.session !== "string" || typeof record.workspace_id !== "string") return null;
	const tabs_by_position: Record<string, { tab_id: string; seed_pane_id: string }> = {};
	const rawTabs = record.tabs_by_position;
	if (rawTabs && typeof rawTabs === "object" && !Array.isArray(rawTabs)) {
		for (const [position, tabValue] of Object.entries(rawTabs as Record<string, unknown>)) {
			if (!tabValue || typeof tabValue !== "object" || Array.isArray(tabValue)) continue;
			const tab = tabValue as Record<string, unknown>;
			if (typeof tab.tab_id !== "string" || typeof tab.seed_pane_id !== "string") continue;
			tabs_by_position[position] = {
				tab_id: tab.tab_id,
				seed_pane_id: tab.seed_pane_id,
			};
		}
	}
	return {
		session: record.session,
		workspace_id: record.workspace_id,
		...(Object.keys(tabs_by_position).length > 0 ? { tabs_by_position } : {}),
	};
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}
