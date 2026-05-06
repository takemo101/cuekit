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

export interface JcodeMcpRegistrationOptions {
	global: boolean;
	cwd?: string;
	home?: string;
	jcodeHome?: string;
	serverName?: string;
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	shared?: boolean;
}

export interface JcodeMcpRegistrationResult {
	path: string;
	serverName: string;
}

interface JcodeMcpConfigFile {
	servers?: Record<string, unknown>;
	[key: string]: unknown;
}

function readConfig(path: string): JcodeMcpConfigFile {
	if (!existsSync(path)) return {};
	const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
	return parsed as JcodeMcpConfigFile;
}

function writeConfig(path: string, config: JcodeMcpConfigFile): void {
	mkdirSync(dirname(path), { recursive: true });
	const tmpPath = `${path}.${process.pid}.tmp`;
	const mode = existsSync(path) ? statSync(path).mode & 0o777 : 0o600;
	writeFileSync(tmpPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
	chmodSync(tmpPath, mode);
	renameSync(tmpPath, path);
}

export function getJcodeMcpConfigPath(
	options: Pick<JcodeMcpRegistrationOptions, "global" | "cwd" | "home" | "jcodeHome">,
): string {
	if (options.global) {
		return join(
			options.jcodeHome ??
				(options.home ? join(options.home, ".jcode") : process.env.JCODE_HOME) ??
				join(homedir(), ".jcode"),
			"mcp.json",
		);
	}
	return resolve(options.cwd ?? process.cwd(), ".jcode", "mcp.json");
}

export function registerJcodeMcpServer(
	options: JcodeMcpRegistrationOptions,
): JcodeMcpRegistrationResult {
	const path = getJcodeMcpConfigPath(options);
	const serverName = options.serverName ?? "cuekit";
	const config = readConfig(path);
	const servers =
		config.servers && typeof config.servers === "object" && !Array.isArray(config.servers)
			? config.servers
			: {};

	servers[serverName] = {
		command: options.command ?? "cuekit",
		args: options.args ?? ["--mcp"],
		env: options.env ?? {},
		shared: options.shared ?? true,
	};
	config.servers = servers;
	writeConfig(path, config);
	return { path, serverName };
}
