import { readFileSync } from "node:fs";
import { parse } from "yaml";
import {
	discoverProjectConfig,
	type ProjectConfigDiscovery,
	type ProjectIdentity,
	projectIdentityFromDiscovery,
} from "./discovery.ts";
import { type CuekitProjectConfig, CuekitProjectConfigSchema } from "./schema.ts";

export type LoadProjectConfigResult =
	| {
			ok: true;
			config: CuekitProjectConfig;
			discovery: ProjectConfigDiscovery;
			identity: ProjectIdentity;
	  }
	| { ok: false; error: string; path?: string };

export function loadProjectConfig(cwd: string): LoadProjectConfigResult {
	const discovery = discoverProjectConfig(cwd);
	if (!discovery.configPath) {
		const config: CuekitProjectConfig = {};
		return {
			ok: true,
			config,
			discovery,
			identity: projectIdentityFromDiscovery(discovery, config),
		};
	}

	let raw: unknown;
	try {
		raw = parse(readFileSync(discovery.configPath, "utf8")) ?? {};
	} catch (error) {
		return {
			ok: false,
			path: discovery.configPath,
			error: `Failed to parse ${discovery.configPath}: ${error instanceof Error ? error.message : String(error)}`,
		};
	}

	const parsed = CuekitProjectConfigSchema.safeParse(raw);
	if (!parsed.success) {
		return {
			ok: false,
			path: discovery.configPath,
			error: `Invalid cuekit project config ${discovery.configPath}: ${parsed.error.issues
				.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
				.join("; ")}`,
		};
	}

	return {
		ok: true,
		config: parsed.data,
		discovery,
		identity: projectIdentityFromDiscovery(discovery, parsed.data),
	};
}
