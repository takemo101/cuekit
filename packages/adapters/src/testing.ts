import type { TmuxRunner, TmuxRunResult } from "./tmux-runner.ts";

// In-memory tmux simulator for tests in this package and downstream consumers.
// Tracks which sessions exist, fabricates pane ids, and records every
// invocation so tests can assert on the command sequence. Shared across
// @cuekit/adapters and @cuekit/mcp tests so the simulator behavior stays
// in one place.
export class FakeTmuxRunner implements TmuxRunner {
	readonly calls: string[][] = [];
	private readonly sessions = new Set<string>();
	private paneCounter = 0;
	// Optional override for the next result (FIFO).
	private readonly queuedResponses: TmuxRunResult[] = [];

	queueResponse(result: TmuxRunResult): void {
		this.queuedResponses.push(result);
	}

	knownSessions(): string[] {
		return [...this.sessions];
	}

	async run(args: string[]): Promise<TmuxRunResult> {
		this.calls.push([...args]);
		if (this.queuedResponses.length > 0) {
			return this.queuedResponses.shift() as TmuxRunResult;
		}

		const cmd = args[0];
		switch (cmd) {
			case "new-session": {
				const sessionName = findFlagValue(args, "-s");
				if (sessionName) this.sessions.add(sessionName);
				this.paneCounter += 1;
				return { stdout: `%${this.paneCounter}\n`, stderr: "", exitCode: 0 };
			}
			case "has-session": {
				const sessionName = findFlagValue(args, "-t");
				return {
					stdout: "",
					stderr: "",
					exitCode: sessionName && this.sessions.has(sessionName) ? 0 : 1,
				};
			}
			case "kill-session": {
				const sessionName = findFlagValue(args, "-t");
				if (sessionName) this.sessions.delete(sessionName);
				return { stdout: "", stderr: "", exitCode: 0 };
			}
			case "pipe-pane":
			case "send-keys":
				return { stdout: "", stderr: "", exitCode: 0 };
			default:
				return { stdout: "", stderr: "", exitCode: 0 };
		}
	}
}

function findFlagValue(args: string[], flag: string): string | undefined {
	const idx = args.indexOf(flag);
	if (idx < 0 || idx + 1 >= args.length) return undefined;
	return args[idx + 1];
}

// Integration-test helpers: detect whether `tmux` is installed on PATH so
// test suites can opt into real-tmux coverage without hard-failing on
// machines without tmux. Exported so multiple integ suites can share the
// same probe without re-implementing it.
export function hasTmux(): boolean {
	try {
		const proc = Bun.spawnSync(["tmux", "-V"], { stdout: "pipe", stderr: "pipe" });
		return proc.exitCode === 0;
	} catch {
		return false;
	}
}

export function hasZellij(): boolean {
	try {
		const proc = Bun.spawnSync(["zellij", "--version"], { stdout: "pipe", stderr: "pipe" });
		return proc.exitCode === 0;
	} catch {
		return false;
	}
}

import type {
	HerdrPaneInfo,
	HerdrReadSource,
	HerdrRunner,
	HerdrSplitDirection,
	HerdrTabCreateResult,
	HerdrWorkspaceCreateResult,
} from "./herdr-runner.ts";
import type { ZellijRunner, ZellijRunResult } from "./zellij-runner.ts";

/**
 * In-memory zellij simulator for unit tests. Tracks sessions, fabricates pane
 * ids in the `terminal_<n>` shape zellij uses, and records every invocation
 * so tests can assert on argv shape.
 */
interface FakeHerdrPane extends HerdrPaneInfo {
	text: string;
	cwd: string;
}

interface FakeHerdrTab {
	tab_id: string;
	label?: string;
}

interface FakeHerdrWorkspace {
	workspace_id: string;
	tab_id: string;
	label?: string;
	cwd: string;
	tabs: FakeHerdrTab[];
	panes: FakeHerdrPane[];
}

interface FakeHerdrSession {
	workspaces: FakeHerdrWorkspace[];
}

export class FakeHerdrRunner implements HerdrRunner {
	readonly calls: Array<{ method: string; params: unknown }> = [];
	private readonly sessions = new Map<string, FakeHerdrSession>();
	private readonly failNextRunPanes = new Set<string>();
	private failNextRenameTabFlag = false;
	private workspaceCounter = 0;

	async probe(): Promise<boolean> {
		this.calls.push({ method: "probe", params: {} });
		return true;
	}

	async createWorkspace(params: {
		session: string;
		cwd: string;
		label?: string;
	}): Promise<HerdrTabCreateResult> {
		this.calls.push({ method: "createWorkspace", params: { ...params } });
		const session = this.ensureSession(params.session);
		this.workspaceCounter += 1;
		const workspaceId = `w${this.workspaceCounter}`;
		const tabId = `${workspaceId}:1`;
		const rootPaneId = `${workspaceId}-1`;
		const pane: FakeHerdrPane = {
			pane_id: rootPaneId,
			workspace_id: workspaceId,
			tab_id: tabId,
			cwd: params.cwd,
			text: "",
		};
		session.workspaces.push({
			workspace_id: workspaceId,
			tab_id: tabId,
			...(params.label ? { label: params.label } : {}),
			cwd: params.cwd,
			tabs: [{ tab_id: tabId, label: "1" }],
			panes: [pane],
		});
		return { workspace_id: workspaceId, tab_id: tabId, root_pane_id: rootPaneId };
	}

	async createTab(params: {
		session: string;
		workspaceId: string;
		cwd?: string;
		label?: string;
	}): Promise<HerdrWorkspaceCreateResult> {
		this.calls.push({ method: "createTab", params: { ...params } });
		const session = this.sessions.get(params.session);
		const workspace = session?.workspaces.find(
			(candidate) => candidate.workspace_id === params.workspaceId,
		);
		if (!workspace) throw new Error(`workspace_not_found: ${params.workspaceId}`);
		const tabId = `${workspace.workspace_id}:${workspace.tabs.length + 1}`;
		const paneId = `${workspace.workspace_id}-${workspace.panes.length + 1}`;
		workspace.tabs.push({ tab_id: tabId, ...(params.label ? { label: params.label } : {}) });
		const pane: FakeHerdrPane = {
			pane_id: paneId,
			workspace_id: workspace.workspace_id,
			tab_id: tabId,
			cwd: params.cwd ?? workspace.cwd,
			text: "",
		};
		workspace.panes.push(pane);
		return { workspace_id: workspace.workspace_id, tab_id: tabId, root_pane_id: paneId };
	}

	async renameTab(params: { session: string; tabId: string; label: string }): Promise<void> {
		this.calls.push({ method: "renameTab", params: { ...params } });
		if (this.failNextRenameTabFlag) {
			this.failNextRenameTabFlag = false;
			throw new Error(`rename_failed: ${params.tabId}`);
		}
		const tab = this.findTab(params.session, params.tabId);
		if (!tab) throw new Error(`tab_not_found: ${params.tabId}`);
		tab.label = params.label;
	}

	async closeTab(params: { session: string; tabId: string }): Promise<void> {
		this.calls.push({ method: "closeTab", params: { ...params } });
		const workspace = this.findWorkspaceForTab(params.session, params.tabId);
		if (!workspace) return;
		workspace.tabs = workspace.tabs.filter((tab) => tab.tab_id !== params.tabId);
		workspace.panes = workspace.panes.filter((pane) => pane.tab_id !== params.tabId);
		this.compactPaneIds(workspace);
	}

	tabLabels(sessionName: string, workspaceId: string): Record<string, string | undefined> {
		const session = this.sessions.get(sessionName);
		const workspace = session?.workspaces.find(
			(candidate) => candidate.workspace_id === workspaceId,
		);
		return Object.fromEntries(workspace?.tabs.map((tab) => [tab.tab_id, tab.label]) ?? []);
	}

	async getPane(params: { session: string; paneId: string }): Promise<HerdrPaneInfo> {
		this.calls.push({ method: "getPane", params: { ...params } });
		const pane = this.findPane(params.session, params.paneId);
		if (!pane) throw new Error(`pane_not_found: ${params.paneId}`);
		return this.publicPane(pane);
	}

	async listPanes(params: { session: string; workspaceId?: string }): Promise<HerdrPaneInfo[]> {
		this.calls.push({ method: "listPanes", params: { ...params } });
		const session = this.sessions.get(params.session);
		if (!session) return [];
		return session.workspaces
			.filter((workspace) => !params.workspaceId || workspace.workspace_id === params.workspaceId)
			.flatMap((workspace) => workspace.panes.map((pane) => this.publicPane(pane)));
	}

	async splitPane(params: {
		session: string;
		targetPaneId: string;
		direction: HerdrSplitDirection;
		cwd?: string;
	}): Promise<HerdrPaneInfo> {
		this.calls.push({ method: "splitPane", params: { ...params } });
		const located = this.findWorkspaceForPane(params.session, params.targetPaneId);
		if (!located) throw new Error(`pane_not_found: ${params.targetPaneId}`);
		const { workspace, pane: targetPane } = located;
		const paneId = `${workspace.workspace_id}-${workspace.panes.length + 1}`;
		const pane: FakeHerdrPane = {
			pane_id: paneId,
			workspace_id: workspace.workspace_id,
			tab_id: targetPane.tab_id,
			cwd: params.cwd ?? workspace.cwd,
			text: "",
		};
		workspace.panes.push(pane);
		return this.publicPane(pane);
	}

	async runInPane(params: { session: string; paneId: string; command: string }): Promise<void> {
		this.calls.push({ method: "runInPane", params: { ...params } });
		const pane = this.requirePane(params.session, params.paneId);
		if (this.failNextRunPanes.delete(params.paneId) || this.failNextRunPanes.delete("*")) {
			throw new Error(`run_failed: ${params.paneId}`);
		}
		pane.text += `$ ${params.command}\n`;
	}

	async sendInput(params: {
		session: string;
		paneId: string;
		text: string;
		keys: string[];
	}): Promise<void> {
		this.calls.push({ method: "sendInput", params: { ...params } });
		const pane = this.requirePane(params.session, params.paneId);
		pane.text += `${params.text}${params.keys.includes("Enter") ? "\n" : ""}`;
	}

	async readPane(params: {
		session: string;
		paneId: string;
		source: HerdrReadSource;
		lines?: number;
	}): Promise<{ text: string }> {
		this.calls.push({ method: "readPane", params: { ...params } });
		const pane = this.requirePane(params.session, params.paneId);
		const lines = pane.text.split("\n");
		const text = params.lines ? lines.slice(-params.lines).join("\n") : pane.text;
		return { text };
	}

	async closePane(params: { session: string; paneId: string }): Promise<void> {
		this.calls.push({ method: "closePane", params: { ...params } });
		const located = this.findWorkspaceForPane(params.session, params.paneId);
		if (!located) throw new Error(`pane_not_found: ${params.paneId}`);
		located.workspace.panes.splice(located.paneIndex, 1);
		this.compactPaneIds(located.workspace);
	}

	async closeWorkspace(params: { session: string; workspaceId: string }): Promise<void> {
		this.calls.push({ method: "closeWorkspace", params: { ...params } });
		const session = this.sessions.get(params.session);
		if (!session) return;
		session.workspaces = session.workspaces.filter(
			(workspace) => workspace.workspace_id !== params.workspaceId,
		);
	}

	failNextRunInPane(paneId = "*"): void {
		this.failNextRunPanes.add(paneId);
	}

	failNextRenameTab(): void {
		this.failNextRenameTabFlag = true;
	}

	forcePaneWorkspaceMismatch(backendPaneId: string, workspaceId: string): void {
		const paneId = backendPaneId.split("/").at(-1) ?? backendPaneId;
		for (const session of this.sessions.values()) {
			for (const workspace of session.workspaces) {
				const pane = workspace.panes.find((candidate) => candidate.pane_id === paneId);
				if (pane) pane.workspace_id = workspaceId;
			}
		}
	}

	private ensureSession(name: string): FakeHerdrSession {
		let session = this.sessions.get(name);
		if (!session) {
			session = { workspaces: [] };
			this.sessions.set(name, session);
		}
		return session;
	}

	private findPane(sessionName: string, paneId: string): FakeHerdrPane | undefined {
		return this.findWorkspaceForPane(sessionName, paneId)?.pane;
	}

	private findWorkspaceForTab(sessionName: string, tabId: string): FakeHerdrWorkspace | undefined {
		const session = this.sessions.get(sessionName);
		return session?.workspaces.find((workspace) =>
			workspace.tabs.some((tab) => tab.tab_id === tabId),
		);
	}

	private findTab(sessionName: string, tabId: string): FakeHerdrTab | undefined {
		return this.findWorkspaceForTab(sessionName, tabId)?.tabs.find((tab) => tab.tab_id === tabId);
	}

	private requirePane(sessionName: string, paneId: string): FakeHerdrPane {
		const pane = this.findPane(sessionName, paneId);
		if (!pane) throw new Error(`pane_not_found: ${paneId}`);
		return pane;
	}

	private findWorkspaceForPane(
		sessionName: string,
		paneId: string,
	): { workspace: FakeHerdrWorkspace; pane: FakeHerdrPane; paneIndex: number } | undefined {
		const session = this.sessions.get(sessionName);
		if (!session) return undefined;
		for (const workspace of session.workspaces) {
			const paneIndex = workspace.panes.findIndex((pane) => pane.pane_id === paneId);
			if (paneIndex >= 0)
				return { workspace, pane: workspace.panes[paneIndex] as FakeHerdrPane, paneIndex };
		}
		return undefined;
	}

	private compactPaneIds(workspace: FakeHerdrWorkspace): void {
		workspace.panes.forEach((pane, index) => {
			pane.pane_id = `${workspace.workspace_id}-${index + 1}`;
		});
	}

	private publicPane(pane: FakeHerdrPane): HerdrPaneInfo {
		return {
			pane_id: pane.pane_id,
			workspace_id: pane.workspace_id,
			tab_id: pane.tab_id,
			...(pane.agent_status ? { agent_status: pane.agent_status } : {}),
		};
	}
}

export function hasHerdr(): boolean {
	try {
		const proc = Bun.spawnSync(["herdr", "--version"], { stdout: "pipe", stderr: "pipe" });
		return proc.exitCode === 0;
	} catch {
		return false;
	}
}

export class FakeZellijRunner implements ZellijRunner {
	readonly calls: string[][] = [];
	private layoutContent: string | undefined;
	private readonly sessions = new Set<string>();
	private readonly panesBySession = new Map<string, Set<number>>();
	private readonly queuedResponses: ZellijRunResult[] = [];
	private paneCounter = 0;

	queueResponse(result: ZellijRunResult): void {
		this.queuedResponses.push(result);
	}

	knownSessions(): string[] {
		return [...this.sessions];
	}

	closePane(sessionName: string, paneId: number): void {
		this.panesBySession.get(sessionName)?.delete(paneId);
	}

	lastLayout(): string {
		return this.layoutContent ?? "";
	}

	async run(args: string[]): Promise<ZellijRunResult> {
		this.calls.push([...args]);
		if (this.queuedResponses.length > 0) {
			return this.queuedResponses.shift() as ZellijRunResult;
		}

		// Top-level commands first.
		const cmd = args[0];
		if (cmd === "--version") {
			return { stdout: "zellij 0.44.2\n", stderr: "", exitCode: 0 };
		}
		if (cmd === "attach") {
			// `zellij attach --create-background <name> [options --default-layout <path>]`
			const idx = args.indexOf("--create-background");
			const sessionName = args[idx + 1];
			if (idx >= 0 && sessionName) {
				this.sessions.add(sessionName);
				this.panesBySession.set(sessionName, new Set([0]));
				const layoutIdx = args.indexOf("--default-layout");
				const layoutPath = args[layoutIdx + 1];
				if (layoutIdx >= 0 && layoutPath) {
					this.layoutContent = await Bun.file(layoutPath).text();
				}
				return { stdout: "", stderr: "", exitCode: 0 };
			}
			return { stdout: "", stderr: "", exitCode: 0 };
		}
		if (cmd === "list-sessions") {
			return { stdout: [...this.sessions].join("\n"), stderr: "", exitCode: 0 };
		}
		if (cmd === "kill-session") {
			// args: ["kill-session", "<session-name>"]
			const sessionName = args[1];
			if (sessionName) {
				this.panesBySession.delete(sessionName);
			}
			return { stdout: "", stderr: "", exitCode: 0 };
		}
		if (cmd === "delete-session") {
			// args: ["delete-session", "<session-name>"]
			const sessionName = args[1];
			if (sessionName) this.sessions.delete(sessionName);
			return { stdout: "", stderr: "", exitCode: 0 };
		}

		// Action subcommands: `--session <name> action <verb> ...`
		if (cmd === "--session") {
			const sessionName = args[1] ?? "";
			const verb = args[3] ?? "";
			if (verb === "new-pane") {
				if (!this.sessions.has(sessionName)) {
					return { stdout: "", stderr: "session not found", exitCode: 1 };
				}
				this.paneCounter += 1;
				this.panesBySession.get(sessionName)?.add(this.paneCounter);
				return { stdout: `terminal_${this.paneCounter}\n`, stderr: "", exitCode: 0 };
			}
			if (verb === "list-panes") {
				const panes = [...(this.panesBySession.get(sessionName) ?? [])].map((id) => ({
					id,
					exited: false,
				}));
				return { stdout: JSON.stringify(panes), stderr: "", exitCode: 0 };
			}
			if (verb === "close-pane") {
				const paneFlag = args.indexOf("-p");
				const paneId = paneFlag >= 0 ? args[paneFlag + 1] : undefined;
				const numeric = paneId?.match(/^terminal_(\d+)$/)?.[1];
				if (numeric) this.panesBySession.get(sessionName)?.delete(Number.parseInt(numeric, 10));
				return { stdout: "", stderr: "", exitCode: 0 };
			}
			if (verb === "write-chars" || verb === "write") {
				return { stdout: "", stderr: "", exitCode: 0 };
			}
			if (verb === "dump-screen") {
				const pathFlag = args.indexOf("--path");
				let pathArg = pathFlag >= 0 ? args[pathFlag + 1] : undefined;
				if (!pathArg) {
					// 0.43 compatibility: path is positional.
					for (let i = 4; i < args.length; i++) {
						const arg = args[i];
						if (arg && !arg.startsWith("--") && arg !== "-f" && arg !== "--full" && arg !== "-p") {
							pathArg = arg;
							break;
						}
					}
				}
				if (pathArg) {
					await Bun.write(pathArg, "fake screen output\n");
				}
				return { stdout: "", stderr: "", exitCode: 0 };
			}
		}

		return { stdout: "", stderr: "", exitCode: 0 };
	}
}
