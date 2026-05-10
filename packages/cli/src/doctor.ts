import { accessSync, constants, existsSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { loadProjectConfig as loadProjectConfigFromDisk } from "@cuekit/project-config";
import { DEFAULT_DB_PATH } from "@cuekit/store";
import pkg from "../package.json" with { type: "json" };
import { formatCheckLine } from "./output.ts";

export type DoctorLevel = "ok" | "warn" | "fail";
export type DoctorCheck = { level: DoctorLevel; label: string; detail: string };
export type DoctorResult = {
	exitCode: number;
	checks: DoctorCheck[];
	stdout: string;
	stderr?: string;
};

export type DoctorExecResult =
	| { ok: true; stdout: string; stderr?: string }
	| { ok: false; stdout?: string; stderr: string };
export type DoctorExec = (command: string, args: string[]) => Promise<DoctorExecResult>;

export type WritableStateResult =
	| { ok: true; path: string }
	| { ok: false; path: string; reason: string };
export type DoctorProjectConfigResult =
	| { ok: true; source: "config"; path: string }
	| { ok: true; source: "git" | "cwd" }
	| { ok: false; error: string };
export type LatestReleaseResult = { ok: true; tag: string } | { ok: false; reason: string };

export type RunDoctorOptions = {
	cwd?: string;
	env?: Record<string, string | undefined>;
	exec?: DoctorExec;
	checkWritableState?: (env: Record<string, string | undefined>) => Promise<WritableStateResult>;
	loadProjectConfig?: (cwd: string) => DoctorProjectConfigResult;
	getCurrentVersion?: () => string | undefined;
	getLatestRelease?: () => Promise<LatestReleaseResult>;
};

type DoctorSpawnSync = (
	command: string,
	args: string[],
) => {
	success: boolean;
	stdout: Uint8Array;
	stderr: Uint8Array;
};

export function createDoctorExec(spawnSync: DoctorSpawnSync): DoctorExec {
	return async (command, args) => {
		try {
			const proc = spawnSync(command, args);
			const stdout = proc.stdout.toString();
			const stderr = proc.stderr.toString();
			return proc.success
				? { ok: true, stdout, stderr }
				: { ok: false, stdout, stderr: stderr || "command failed" };
		} catch (error) {
			return { ok: false, stderr: error instanceof Error ? error.message : String(error) };
		}
	};
}

export const defaultDoctorExec = createDoctorExec((command, args) =>
	Bun.spawnSync([command, ...args], { stdout: "pipe", stderr: "pipe" }),
);

function findWritableExistingParent(path: string): string | undefined {
	let current = path;
	while (true) {
		if (existsSync(current)) {
			try {
				if (statSync(current).isDirectory()) return current;
			} catch {
				return undefined;
			}
		}
		const parent = dirname(current);
		if (parent === current) return undefined;
		current = parent;
	}
}

async function defaultCheckWritableState(
	env: Record<string, string | undefined>,
): Promise<WritableStateResult> {
	const path =
		env.CUEKIT_DB_PATH && env.CUEKIT_DB_PATH.length > 0 ? env.CUEKIT_DB_PATH : DEFAULT_DB_PATH;
	if (path === ":memory:") return { ok: true, path };
	const parent = findWritableExistingParent(dirname(path));
	if (!parent) return { ok: false, path, reason: "no writable parent directory found" };
	try {
		accessSync(parent, constants.W_OK);
		return { ok: true, path };
	} catch (error) {
		return { ok: false, path, reason: error instanceof Error ? error.message : String(error) };
	}
}

function readRequestedMultiplexer(cwd: string): "tmux" | "zellij" {
	try {
		const loaded = loadProjectConfigFromDisk(cwd);
		if (loaded.ok && loaded.discovery.source === "config") {
			return loaded.config.multiplexer ?? "tmux";
		}
	} catch {
		// fall through
	}
	return "tmux";
}

function defaultLoadProjectConfig(cwd: string): DoctorProjectConfigResult {
	const loaded = loadProjectConfigFromDisk(cwd);
	if (!loaded.ok) return { ok: false, error: loaded.error };
	if (loaded.discovery.source === "config" && loaded.discovery.configPath) {
		return { ok: true, source: "config", path: loaded.discovery.configPath };
	}
	return { ok: true, source: loaded.discovery.source === "git" ? "git" : "cwd" };
}

async function defaultGetLatestRelease(): Promise<LatestReleaseResult> {
	try {
		const response = await fetch("https://api.github.com/repos/takemo101/cuekit/releases/latest", {
			headers: { accept: "application/vnd.github+json" },
		});
		if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` };
		const body = (await response.json()) as { tag_name?: unknown };
		return typeof body.tag_name === "string" && body.tag_name.length > 0
			? { ok: true, tag: body.tag_name }
			: { ok: false, reason: "missing tag_name" };
	} catch (error) {
		return { ok: false, reason: error instanceof Error ? error.message : String(error) };
	}
}

function trimVersionOutput(value: string): string {
	return value.trim().split(/\s+/).join(" ");
}

function normalizeReleaseVersion(value: string): string {
	return value.trim().replace(/^v/, "");
}

const ADAPTER_EXECUTABLES = [
	{ kind: "claude-code", command: "claude" },
	{ kind: "pi", command: "pi" },
	{ kind: "opencode", command: "opencode" },
	{ kind: "jcode", command: "jcode" },
	{ kind: "gemini", command: "gemini" },
] as const;

function renderDoctor(checks: DoctorCheck[]): string {
	return [
		"cuekit doctor",
		"",
		...checks.map(formatCheckLine),
		"",
		"Next:",
		"  cuekit mcp config",
		"  cuekit update",
		"",
	].join("\n");
}

export async function runDoctor(options: RunDoctorOptions = {}): Promise<DoctorResult> {
	const env = options.env ?? process.env;
	const exec = options.exec ?? defaultDoctorExec;
	const checks: DoctorCheck[] = [];

	const currentVersion = options.getCurrentVersion ? options.getCurrentVersion() : pkg.version;
	checks.push(
		currentVersion
			? { level: "ok", label: "cuekit", detail: currentVersion }
			: { level: "warn", label: "cuekit", detail: "version unknown" },
	);

	const bunVersion = await exec("bun", ["--version"]);
	checks.push(
		bunVersion.ok
			? { level: "ok", label: "bun", detail: trimVersionOutput(bunVersion.stdout) }
			: { level: "fail", label: "bun", detail: bunVersion.stderr || "not found" },
	);

	// Active multiplexer backend. Reads `multiplexer:` from project config
	// (default tmux). When zellij is configured but its probe fails, the
	// runtime factory soft-falls-back to tmux; doctor reports this so the
	// operator can see at a glance whether they got the backend they asked
	// for.
	const cwdForConfig = options.cwd ?? process.cwd();
	const requestedMultiplexer = readRequestedMultiplexer(cwdForConfig);
	const zellijProbe =
		requestedMultiplexer === "zellij" ? await exec("zellij", ["--version"]) : null;
	const fallbackApplied =
		requestedMultiplexer === "zellij" && zellijProbe !== null && !zellijProbe.ok;
	const activeBackend = fallbackApplied ? "tmux (fallback from zellij)" : requestedMultiplexer;
	checks.push({ level: "ok", label: "active backend", detail: activeBackend });

	if (zellijProbe !== null) {
		checks.push(
			zellijProbe.ok
				? { level: "ok", label: "zellij", detail: trimVersionOutput(zellijProbe.stdout) }
				: {
						level: "warn",
						label: "zellij",
						detail: zellijProbe.stderr || "not found (falling back to tmux)",
					},
		);
	}

	const tmuxVersion = await exec("tmux", ["-V"]);
	checks.push(
		tmuxVersion.ok
			? { level: "ok", label: "tmux", detail: trimVersionOutput(tmuxVersion.stdout) }
			: { level: "fail", label: "tmux", detail: tmuxVersion.stderr || "not found" },
	);

	// Confirm `capture-pane` is recognised as a subcommand. cuekit's TUI
	// reads live pane content through `tmux capture-pane -p -e -J ...`
	// (#376), so a tmux without that subcommand would silently fall back
	// to the file-tail and the operator would never know why the live
	// view stayed stale. Probing against a guaranteed-missing target
	// returns a 1 with "no such session" — that's the success path here.
	if (tmuxVersion.ok) {
		const capture = await exec("tmux", [
			"capture-pane",
			"-p",
			"-t",
			"cuekit-doctor-probe-no-such-session",
		]);
		const stderr = (capture.stderr ?? "").toLowerCase();
		const supportsCapture =
			capture.ok || stderr.includes("session") || stderr.includes("can't find");
		checks.push(
			supportsCapture
				? {
						level: "ok",
						label: "tmux capture-pane",
						detail: "supported",
					}
				: {
						level: "warn",
						label: "tmux capture-pane",
						detail: capture.stderr || "subcommand not recognised",
					},
		);
	}

	const writableState = await (options.checkWritableState ?? defaultCheckWritableState)(env);
	checks.push(
		writableState.ok
			? { level: "ok", label: "state db", detail: `${writableState.path} writable` }
			: {
					level: "fail",
					label: "state db",
					detail: `${writableState.path}: ${writableState.reason}`,
				},
	);

	const projectConfig = (options.loadProjectConfig ?? defaultLoadProjectConfig)(
		options.cwd ?? process.cwd(),
	);
	if (!projectConfig.ok) {
		checks.push({ level: "fail", label: "project config", detail: projectConfig.error });
	} else if (projectConfig.source === "config") {
		checks.push({ level: "ok", label: "project config", detail: projectConfig.path });
	} else {
		checks.push({
			level: "warn",
			label: "project config",
			detail: `not found (using ${projectConfig.source} scope)`,
		});
	}

	checks.push({ level: "ok", label: "MCP config helper", detail: "cuekit mcp config" });

	for (const adapter of ADAPTER_EXECUTABLES) {
		const result = await exec(adapter.command, ["--version"]);
		checks.push(
			result.ok
				? {
						level: "ok",
						label: `adapter ${adapter.kind}`,
						detail: `${adapter.command} found`,
					}
				: {
						level: "warn",
						label: `adapter ${adapter.kind}`,
						detail: `${adapter.command} not found`,
					},
		);
	}

	const latest = await (options.getLatestRelease ?? defaultGetLatestRelease)();
	if (!latest.ok) {
		checks.push({ level: "warn", label: "update", detail: `skipped (${latest.reason})` });
	} else if (
		currentVersion &&
		normalizeReleaseVersion(currentVersion) === normalizeReleaseVersion(latest.tag)
	) {
		checks.push({ level: "ok", label: "update", detail: "up to date" });
	} else {
		checks.push({ level: "warn", label: "update", detail: `${latest.tag} available` });
	}

	const exitCode = checks.some((check) => check.level === "fail") ? 1 : 0;
	return { exitCode, checks, stdout: renderDoctor(checks) };
}
