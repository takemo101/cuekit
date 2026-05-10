#!/usr/bin/env bun
import type { Database } from "bun:sqlite";
import { existsSync, statSync } from "node:fs";
import { type AdapterRegistry, buildAdapterRegistry, TmuxBackend } from "@cuekit/adapters";
import { findProjectRoot } from "@cuekit/agent-profiles";
import { createStderrLogger, parseLogLevel } from "@cuekit/core";
import { createTuiContext, runCuekitMcpBin } from "@cuekit/mcp";
import { loadProjectConfig } from "@cuekit/project-config";
import { openDatabase, runMigrations } from "@cuekit/store";
import {
	classifyCuekitCommand,
	printDoctorHelp,
	printMainHelp,
	printUpdateHelp,
} from "./dispatch.ts";
import { runDoctor } from "./doctor.ts";
import {
	printTuiHelp,
	runInitCommand,
	runJcodeMcpAddCommand,
	runPiMcpAddCommand,
} from "./human-commands.ts";
import { runUpdate } from "./update.ts";

function closeQuietly(db: Database): void {
	try {
		db.close();
	} catch {
		// ignore close errors on shutdown
	}
}

// Re-export the canonical adapter-registry factory under a TUI-specific
// name to preserve the existing call sites and regression-test imports.
// The actual build-out lives in `@cuekit/adapters/build-registry` so it
// can be shared between `cuekit --mcp` (the MCP server) and
// `cuekit tui` (this binary). See #382 for the unification rationale.
export const buildTuiAdapterRegistry: (
	db: Database,
	panes: TmuxBackend,
	options?: { logger?: import("@cuekit/core").Logger },
) => AdapterRegistry = buildAdapterRegistry;

async function runTuiCommand(): Promise<void> {
	const logLevel = parseLogLevel(process.env.CUEKIT_LOG_LEVEL);
	const logger = createStderrLogger({ minLevel: logLevel });
	let db: Database | undefined;
	try {
		const dbPath = process.env.CUEKIT_DB_PATH;
		const useCustomPath = dbPath !== undefined && dbPath.length > 0;
		db = openDatabase(useCustomPath ? { path: dbPath } : {});
		runMigrations(db);

		const panes = new TmuxBackend();
		const registry = buildTuiAdapterRegistry(db, panes, { logger });

		const { runTuiLoop } = await import("@cuekit/tui");
		const all = process.argv.includes("--all");
		const pathScope = process.argv.includes("--path");
		const projectRoot = findProjectRoot(process.cwd(), { existsSync, statSync });
		const loadedConfig = all || pathScope ? undefined : loadProjectConfig(process.cwd());
		if (loadedConfig && !loadedConfig.ok) {
			throw new Error(loadedConfig.error);
		}
		await runTuiLoop(
			createTuiContext(
				{ db, registry },
				{
					all,
					...(loadedConfig?.ok && loadedConfig.discovery.source === "config"
						? loadedConfig.config.tui?.scope === "path"
							? { projectRoot }
							: {
									projectScope: {
										project_uid: loadedConfig.identity.project_uid,
										project_root: loadedConfig.discovery.configRoot,
									},
								}
						: { projectRoot }),
				},
			) as never,
		);
		closeQuietly(db);
	} catch (err) {
		if (db) closeQuietly(db);
		logger.error("tui startup failed", {
			reason: err instanceof Error ? err.message : String(err),
		});
		process.exit(1);
	}
}

export async function runCuekitCliBin(): Promise<void> {
	const argv = process.argv.slice(2);
	const classification = classifyCuekitCommand(argv);
	if (classification.kind === "help") {
		process.stdout.write(printMainHelp());
		return;
	}
	if (classification.kind === "init") {
		const result = runInitCommand(argv.slice(1));
		process.stdout.write(result.stdout);
		if (result.stderr) process.stderr.write(result.stderr);
		if (result.exitCode !== 0) process.exit(result.exitCode);
		return;
	}
	if (classification.kind === "tui" && (argv.includes("--help") || argv.includes("-h"))) {
		process.stdout.write(printTuiHelp());
		return;
	}
	if (classification.kind === "tui") {
		await runTuiCommand();
		return;
	}
	if (classification.kind === "mcp-add") {
		const jcodeResult = runJcodeMcpAddCommand(argv.slice(2));
		const result = jcodeResult.shouldDelegate ? runPiMcpAddCommand(argv.slice(2)) : jcodeResult;
		process.stdout.write(result.stdout);
		if (result.stderr) process.stderr.write(result.stderr);
		if (result.exitCode !== 0) process.exit(result.exitCode);
		if (!result.shouldDelegate) return;
		process.argv = [process.argv[0] ?? "bun", process.argv[1] ?? "cuekit", ...result.delegateArgv];
	}
	if (classification.kind === "doctor") {
		if (argv.includes("--help") || argv.includes("-h")) {
			process.stdout.write(printDoctorHelp());
			return;
		}
		const result = await runDoctor();
		process.stdout.write(result.stdout);
		if (result.stderr) process.stderr.write(result.stderr);
		process.exit(result.exitCode);
	}
	if (classification.kind === "update") {
		if (argv.includes("--help") || argv.includes("-h")) {
			process.stdout.write(printUpdateHelp());
			return;
		}
		const result = await runUpdate();
		process.stdout.write(result.stdout);
		if (result.stderr) process.stderr.write(result.stderr);
		process.exit(result.exitCode);
	}
	await runCuekitMcpBin();
}

if (import.meta.main) {
	await runCuekitCliBin();
}
