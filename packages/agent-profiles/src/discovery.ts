import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { BUILTIN_AGENT_PROFILE_MARKDOWN } from "./builtins.ts";
import { parseAgentProfileMarkdown } from "./frontmatter.ts";
import { type MergeAgentProfilesResult, mergeAgentProfiles } from "./merge.ts";
import { type FileSystemLike, findProjectRoot } from "./project-root.ts";
import type { AgentProfileFile, AgentProfileSource } from "./schema.ts";

interface DiscoveryFileSystem extends FileSystemLike {
	readdirSync(path: string): string[];
	readFileSync(path: string, encoding: "utf8"): string;
}

const nodeFs: DiscoveryFileSystem = { existsSync, readdirSync, readFileSync, statSync };

export interface DiscoverAgentProfilesOptions {
	cwd?: string;
	userDir?: string;
	fs?: DiscoveryFileSystem;
}

export type DiscoverAgentProfilesResult = MergeAgentProfilesResult;

function discoverBuiltinProfiles(): AgentProfileFile[] {
	return Object.entries(BUILTIN_AGENT_PROFILE_MARKDOWN).map(([id, content]) => {
		const parsed = parseAgentProfileMarkdown({
			content,
			source: "builtin",
			filePath: `builtin:${id}`,
		});
		if (!parsed.ok) throw new Error(parsed.error);
		return parsed.profile;
	});
}

function discoverDirectoryProfiles(
	dir: string,
	source: AgentProfileSource,
	fs: DiscoveryFileSystem,
): { ok: true; profiles: AgentProfileFile[] } | { ok: false; error: string } {
	if (!fs.existsSync(dir)) return { ok: true, profiles: [] };
	const stat = fs.statSync(dir);
	if (!stat.isDirectory()) return { ok: true, profiles: [] };
	const profiles: AgentProfileFile[] = [];
	for (const entry of fs.readdirSync(dir).sort()) {
		if (!entry.endsWith(".md")) continue;
		const filePath = resolve(dir, entry);
		const fileStat = fs.statSync(filePath);
		if (!fileStat.isFile()) continue;
		const parsed = parseAgentProfileMarkdown({
			content: fs.readFileSync(filePath, "utf8"),
			source,
			filePath,
		});
		if (!parsed.ok) return { ok: false, error: `${filePath}: ${parsed.error}` };
		profiles.push(parsed.profile);
	}
	return { ok: true, profiles };
}

export function discoverAgentProfiles(
	options: DiscoverAgentProfilesOptions = {},
): DiscoverAgentProfilesResult {
	const fs = options.fs ?? nodeFs;
	const cwd = resolve(options.cwd ?? process.cwd());
	const projectRoot = findProjectRoot(cwd, fs);
	const userDir = options.userDir ?? resolve(homedir(), ".cuekit", "agents");
	const user = discoverDirectoryProfiles(userDir, "user", fs);
	if (!user.ok) return user;
	const project = discoverDirectoryProfiles(
		resolve(projectRoot, ".cuekit", "agents"),
		"project",
		fs,
	);
	if (!project.ok) return project;
	return mergeAgentProfiles([...discoverBuiltinProfiles(), ...user.profiles, ...project.profiles]);
}
