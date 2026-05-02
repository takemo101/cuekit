import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { CuekitProjectConfig } from "./schema.ts";

export const PROJECT_CONFIG_FILENAME = ".cuekit.yaml";

export interface ProjectConfigDiscovery {
	cwd: string;
	configPath?: string;
	configRoot: string;
	projectRoot: string;
	source: "config" | "git" | "cwd";
}

export interface ProjectIdentity {
	config_root?: string;
	project_id?: string;
	project_name?: string;
	project_uid?: string;
	project_root: string;
}

export interface FileSystemLike {
	existsSync(path: string): boolean;
	statSync(path: string): { isDirectory(): boolean; isFile(): boolean };
}

const nodeFs: FileSystemLike = { existsSync, statSync };

function findUp(cwd: string, predicate: (dir: string) => string | undefined): string | undefined {
	let current = resolve(cwd);
	while (true) {
		const found = predicate(current);
		if (found) return found;
		const parent = dirname(current);
		if (parent === current) return undefined;
		current = parent;
	}
}

function isExistingFile(path: string, fs: FileSystemLike): boolean {
	if (!fs.existsSync(path)) return false;
	try {
		return fs.statSync(path).isFile();
	} catch {
		return false;
	}
}

function isGitRoot(path: string, fs: FileSystemLike): boolean {
	const gitPath = join(path, ".git");
	if (!fs.existsSync(gitPath)) return false;
	try {
		const stat = fs.statSync(gitPath);
		return stat.isDirectory() || stat.isFile();
	} catch {
		return false;
	}
}

export function discoverProjectConfig(
	cwd: string,
	options: { fs?: FileSystemLike } = {},
): ProjectConfigDiscovery {
	const fs = options.fs ?? nodeFs;
	const resolvedCwd = resolve(cwd);
	const configPath = findUp(resolvedCwd, (dir) => {
		const candidate = join(dir, PROJECT_CONFIG_FILENAME);
		return isExistingFile(candidate, fs) ? candidate : undefined;
	});
	if (configPath) {
		const configRoot = dirname(configPath);
		return {
			cwd: resolvedCwd,
			configPath,
			configRoot,
			projectRoot: configRoot,
			source: "config",
		};
	}
	const gitRoot = findUp(resolvedCwd, (dir) => (isGitRoot(dir, fs) ? dir : undefined));
	if (gitRoot) {
		return {
			cwd: resolvedCwd,
			configRoot: gitRoot,
			projectRoot: gitRoot,
			source: "git",
		};
	}
	return {
		cwd: resolvedCwd,
		configRoot: resolvedCwd,
		projectRoot: resolvedCwd,
		source: "cwd",
	};
}

function sanitizeProjectId(value: string): string {
	const sanitized = value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
	return sanitized.length > 0 ? sanitized : "project";
}

function derivedProjectId(configRoot: string): string {
	const root = resolve(configRoot);
	const name = sanitizeProjectId(basename(root));
	const hash = createHash("sha256").update(root).digest("hex").slice(0, 8);
	return `${name}-${hash}`;
}

function projectUid(configRoot: string, projectId: string): string {
	const hash = createHash("sha256")
		.update(`${resolve(configRoot)}\0${projectId}`)
		.digest("hex")
		.slice(0, 16);
	return `pc_${hash}`;
}

export function projectIdentityFromConfig(input: {
	configRoot: string;
	projectRoot: string;
	config: CuekitProjectConfig;
}): ProjectIdentity {
	const configRoot = resolve(input.configRoot);
	const projectId = input.config.project?.id ?? derivedProjectId(configRoot);
	return {
		config_root: configRoot,
		project_id: projectId,
		...(input.config.project?.name ? { project_name: input.config.project.name } : {}),
		project_uid: projectUid(configRoot, projectId),
		project_root: resolve(input.projectRoot),
	};
}

export function projectIdentityFromDiscovery(
	discovery: ProjectConfigDiscovery,
	config: CuekitProjectConfig,
): ProjectIdentity {
	if (discovery.source !== "config") {
		return { project_root: discovery.projectRoot };
	}
	return projectIdentityFromConfig({
		configRoot: discovery.configRoot,
		projectRoot: discovery.projectRoot,
		config,
	});
}
