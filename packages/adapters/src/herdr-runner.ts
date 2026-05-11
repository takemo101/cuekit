import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type HerdrReadSource = "visible" | "recent" | "recent_unwrapped";
export type HerdrSplitDirection = "right" | "down";

export interface HerdrWorkspaceCreateResult {
	workspace_id: string;
	tab_id: string;
	root_pane_id: string;
}

export interface HerdrTabCreateResult {
	workspace_id: string;
	tab_id: string;
	root_pane_id: string;
}

export interface HerdrPaneInfo {
	pane_id: string;
	workspace_id: string;
	tab_id: string;
	agent_status?: string;
}

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
	return value && typeof value === "object" ? (value as JsonObject) : {};
}

function stringField(value: unknown): string {
	return typeof value === "string" ? value : "";
}

export interface HerdrRunner {
	probe(): Promise<boolean>;
	createWorkspace(params: {
		session: string;
		cwd: string;
		label?: string;
	}): Promise<HerdrWorkspaceCreateResult>;
	createTab(params: {
		session: string;
		workspaceId: string;
		cwd?: string;
		label?: string;
	}): Promise<HerdrTabCreateResult>;
	renameTab(params: { session: string; tabId: string; label: string }): Promise<void>;
	closeTab(params: { session: string; tabId: string }): Promise<void>;
	getPane(params: { session: string; paneId: string }): Promise<HerdrPaneInfo>;
	listPanes(params: { session: string; workspaceId?: string }): Promise<HerdrPaneInfo[]>;
	splitPane(params: {
		session: string;
		targetPaneId: string;
		direction: HerdrSplitDirection;
		cwd?: string;
	}): Promise<HerdrPaneInfo>;
	runInPane(params: { session: string; paneId: string; command: string }): Promise<void>;
	sendInput(params: {
		session: string;
		paneId: string;
		text: string;
		keys: string[];
	}): Promise<void>;
	readPane(params: {
		session: string;
		paneId: string;
		source: HerdrReadSource;
		lines?: number;
	}): Promise<{ text: string }>;
	closePane(params: { session: string; paneId: string }): Promise<void>;
	closeWorkspace(params: { session: string; workspaceId: string }): Promise<void>;
}

export interface HerdrCliRunnerOptions {
	herdrBin?: string;
	env?: Record<string, string | undefined>;
}

export function defaultHerdrRunner(options: HerdrCliRunnerOptions = {}): HerdrRunner {
	return new HerdrCliRunner(options);
}

class HerdrCliRunner implements HerdrRunner {
	private readonly herdrBin: string;
	private readonly env?: Record<string, string | undefined>;

	constructor(options: HerdrCliRunnerOptions) {
		this.herdrBin = options.herdrBin ?? "herdr";
		this.env = options.env;
	}

	async probe(): Promise<boolean> {
		const result = await this.run(["--version"]);
		return result.exitCode === 0;
	}

	async createWorkspace(params: {
		session: string;
		cwd: string;
		label?: string;
	}): Promise<HerdrWorkspaceCreateResult> {
		const args = ["--session", params.session, "workspace", "create", "--cwd", params.cwd];
		if (params.label) args.push("--label", params.label);
		const json = await this.runJson(args);
		const result = asObject(json.result ?? json);
		const workspace = asObject(result.workspace);
		const tab = asObject(result.tab);
		const rootPane = asObject(result.root_pane);
		return {
			workspace_id: stringField(workspace.workspace_id ?? result.workspace_id),
			tab_id: stringField(tab.tab_id ?? result.tab_id),
			root_pane_id: stringField(rootPane.pane_id ?? result.root_pane_id),
		};
	}

	async createTab(params: {
		session: string;
		workspaceId: string;
		cwd?: string;
		label?: string;
	}): Promise<HerdrTabCreateResult> {
		const args = ["--session", params.session, "tab", "create", "--workspace", params.workspaceId];
		if (params.cwd) args.push("--cwd", params.cwd);
		if (params.label) args.push("--label", params.label);
		args.push("--no-focus");
		const json = await this.runJson(args);
		const result = asObject(json.result ?? json);
		const tab = asObject(result.tab);
		const rootPane = asObject(result.root_pane);
		return {
			workspace_id: stringField(tab.workspace_id ?? result.workspace_id ?? params.workspaceId),
			tab_id: stringField(tab.tab_id ?? result.tab_id),
			root_pane_id: stringField(rootPane.pane_id ?? result.root_pane_id),
		};
	}

	async renameTab(params: { session: string; tabId: string; label: string }): Promise<void> {
		await this.runOk(["--session", params.session, "tab", "rename", params.tabId, params.label]);
	}

	async closeTab(params: { session: string; tabId: string }): Promise<void> {
		await this.runOk(["--session", params.session, "tab", "close", params.tabId]);
	}

	async getPane(params: { session: string; paneId: string }): Promise<HerdrPaneInfo> {
		const json = await this.runJson(["--session", params.session, "pane", "get", params.paneId]);
		const result = asObject(json.result ?? json);
		const pane = asObject(result.pane ?? json.pane ?? result);
		const agentStatus = stringField(pane.agent_status);
		return {
			pane_id: stringField(pane.pane_id),
			workspace_id: stringField(pane.workspace_id),
			tab_id: stringField(pane.tab_id),
			...(agentStatus ? { agent_status: agentStatus } : {}),
		};
	}

	async listPanes(params: { session: string; workspaceId?: string }): Promise<HerdrPaneInfo[]> {
		const args = ["--session", params.session, "pane", "list"];
		if (params.workspaceId) args.push("--workspace", params.workspaceId);
		const json = await this.runJson(args);
		const result = asObject(json.result ?? json);
		const panes = Array.isArray(result.panes) ? result.panes : [];
		return panes.map((entry) => {
			const pane = asObject(entry);
			const agentStatus = stringField(pane.agent_status);
			return {
				pane_id: stringField(pane.pane_id),
				workspace_id: stringField(pane.workspace_id),
				tab_id: stringField(pane.tab_id),
				...(agentStatus ? { agent_status: agentStatus } : {}),
			};
		});
	}

	async splitPane(params: {
		session: string;
		targetPaneId: string;
		direction: HerdrSplitDirection;
		cwd?: string;
	}): Promise<HerdrPaneInfo> {
		const args = [
			"--session",
			params.session,
			"pane",
			"split",
			params.targetPaneId,
			"--direction",
			params.direction,
		];
		if (params.cwd) args.push("--cwd", params.cwd);
		const json = await this.runJson(args);
		const result = asObject(json.result ?? json);
		const pane = asObject(result.pane ?? json.pane ?? result);
		return {
			pane_id: stringField(pane.pane_id),
			workspace_id: stringField(pane.workspace_id),
			tab_id: stringField(pane.tab_id),
		};
	}

	async runInPane(params: { session: string; paneId: string; command: string }): Promise<void> {
		await this.runOk(["--session", params.session, "pane", "run", params.paneId, params.command]);
	}

	async sendInput(params: {
		session: string;
		paneId: string;
		text: string;
		keys: string[];
	}): Promise<void> {
		if (params.keys.length === 1 && params.keys[0] === "Enter") {
			await this.runOk(["--session", params.session, "pane", "run", params.paneId, params.text]);
			return;
		}
		await this.runOk([
			"--session",
			params.session,
			"pane",
			"send-text",
			params.paneId,
			params.text,
		]);
		if (params.keys.length > 0) {
			await this.runOk([
				"--session",
				params.session,
				"pane",
				"send-keys",
				params.paneId,
				...params.keys,
			]);
		}
	}

	async readPane(params: {
		session: string;
		paneId: string;
		source: HerdrReadSource;
		lines?: number;
	}): Promise<{ text: string }> {
		const source = params.source === "recent_unwrapped" ? "recent-unwrapped" : params.source;
		const args = ["--session", params.session, "pane", "read", params.paneId, "--source", source];
		if (params.lines !== undefined) args.push("--lines", String(params.lines));
		const result = await this.run(args);
		if (result.exitCode !== 0) throw new Error(result.stderr || "herdr pane read failed");
		return { text: result.stdout };
	}

	async closePane(params: { session: string; paneId: string }): Promise<void> {
		await this.runOk(["--session", params.session, "pane", "close", params.paneId]);
	}

	async closeWorkspace(params: { session: string; workspaceId: string }): Promise<void> {
		await this.runOk(["--session", params.session, "workspace", "close", params.workspaceId]);
	}

	private async runJson(args: string[]): Promise<JsonObject> {
		const result = await this.run(args);
		if (result.exitCode !== 0) throw new Error(result.stderr || `herdr ${args.join(" ")} failed`);
		return JSON.parse(result.stdout);
	}

	private async runOk(args: string[]): Promise<void> {
		const result = await this.run(args);
		if (result.exitCode !== 0) throw new Error(result.stderr || `herdr ${args.join(" ")} failed`);
	}

	private async run(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
		const proc = Bun.spawn([this.herdrBin, ...args], {
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
			env: this.env ? { ...process.env, ...this.env } : undefined,
		});
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		return { stdout, stderr, exitCode };
	}
}

export async function writeHerdrLaunchScripts(params: {
	dir: string;
	env?: Record<string, string>;
	command: string;
}): Promise<string> {
	await mkdir(params.dir, { recursive: true, mode: 0o700 });
	const envPath = `${params.dir}/env.sh`;
	const envExports = Object.entries(params.env ?? {})
		.map(([key, value]) => `export ${key}=${shellQuote(value)}`)
		.join("\n");
	await writeFile(envPath, `${envExports}\n`, { mode: 0o600 });
	const launchPath = `${params.dir}/launch.sh`;
	await writeFile(
		launchPath,
		`#!/bin/sh\ntrap 'rm -rf ${shellQuote(params.dir)}' EXIT HUP INT TERM\n. ${shellQuote(envPath)}\n${params.command}\n`,
		{ mode: 0o700 },
	);
	return launchPath;
}

export async function cleanupHerdrLaunchDir(path: string): Promise<void> {
	await rm(dirname(path), { recursive: true, force: true }).catch(() => {});
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}
