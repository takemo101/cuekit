import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export interface PiMcpRegistrationOptions {
	global: boolean;
	cwd?: string;
	home?: string;
	serverName?: string;
	command?: string;
	args?: string[];
}

export interface PiMcpRegistrationResult {
	path: string;
	serverName: string;
}

interface McpConfigFile {
	mcpServers?: Record<string, unknown>;
	[key: string]: unknown;
}

function readConfig(path: string): McpConfigFile {
	if (!existsSync(path)) return {};
	const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
	return parsed as McpConfigFile;
}

function writeConfig(path: string, config: McpConfigFile): void {
	mkdirSync(dirname(path), { recursive: true });
	const tmpPath = `${path}.${process.pid}.tmp`;
	const mode = existsSync(path) ? statSync(path).mode & 0o777 : 0o600;
	writeFileSync(tmpPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
	chmodSync(tmpPath, mode);
	renameSync(tmpPath, path);
}

export function getPiMcpConfigPath(
	options: Pick<PiMcpRegistrationOptions, "global" | "cwd" | "home">,
): string {
	if (options.global) {
		return join(options.home ?? homedir(), ".config", "mcp", "mcp.json");
	}
	return resolve(options.cwd ?? process.cwd(), ".mcp.json");
}

export function registerPiMcpServer(options: PiMcpRegistrationOptions): PiMcpRegistrationResult {
	const path = getPiMcpConfigPath(options);
	const serverName = options.serverName ?? "cuekit";
	const config = readConfig(path);
	const mcpServers =
		config.mcpServers && typeof config.mcpServers === "object" && !Array.isArray(config.mcpServers)
			? config.mcpServers
			: {};

	mcpServers[serverName] = {
		command: options.command ?? "cuekit",
		args: options.args ?? ["--mcp"],
	};
	config.mcpServers = mcpServers;
	writeConfig(path, config);
	return { path, serverName };
}
