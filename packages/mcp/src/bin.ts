#!/usr/bin/env bun
import type { Database } from "bun:sqlite";
import { existsSync, statSync } from "node:fs";
import {
	AdapterRegistry,
	createClaudeCodeAdapter,
	createOpenCodeAdapter,
	createPiAdapter,
	PaneBackend,
} from "@cuekit/adapters";
import { findProjectRoot } from "@cuekit/agent-profiles";
import { createStderrLogger, parseLogLevel } from "@cuekit/core";
import { loadProjectConfig } from "@cuekit/project-config";
import { openDatabase, runMigrations } from "@cuekit/store";
import { createCli, createMcpCli, createMcpConfigCli } from "./cli.ts";
import { registerPiMcpServer } from "./pi-mcp-config.ts";
import { createTuiContext } from "./tui-context.ts";

// Default cuekit entry point: opens ~/.cuekit/state.db, migrates, wires the
// tmux pane backend + all three adapters, and hands argv to incur.
// `cuekit --mcp` flips incur into stdio MCP server mode; `cuekit <command>`
// runs the command once from the CLI.

function closeQuietly(db: Database): void {
	try {
		db.close();
	} catch {
		// ignore close errors on shutdown
	}
}

const TUI_PACKAGE_NAME = "@cuekit/tui";

function printTuiHelp(): void {
	process.stdout.write(
		[
			"cuekit tui — interactive task cockpit",
			"",
			"Usage: cuekit tui [--path] [--all]",
			"",
			"By default, uses .cuekit.yaml project scope when present, otherwise the current repository/worktree.",
			"Use --path to ignore .cuekit.yaml identity and scope by the current path/Git root.",
			"Use --all to show tasks across all projects for this invocation.",
			"",
			"Keys: ↑/↓ select, r refresh, a attach, s steer, c cancel, d delete, q quit",
			"",
		].join("\n"),
	);
}

function installSignalHandlers(db: Database): void {
	const shutdown = (code: number) => {
		closeQuietly(db);
		process.exit(code);
	};
	process.on("SIGINT", () => shutdown(130));
	process.on("SIGTERM", () => shutdown(143));
}

function splitPiAgentArgs(argv: string[]): { hasPi: boolean; rest: string[] } {
	const rest: string[] = [];
	let hasPi = false;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === undefined) continue;
		if ((arg === "--agent" || arg === "-a") && argv[i + 1] === "pi") {
			hasPi = true;
			i++;
			continue;
		}
		if (arg === "--agent=pi" || arg === "-a=pi") {
			hasPi = true;
			continue;
		}
		rest.push(arg);
	}
	return { hasPi, rest };
}

function hasExplicitAgent(argv: string[]): boolean {
	return argv.some(
		(arg) =>
			arg === "--agent" || arg === "-a" || arg.startsWith("--agent=") || arg.startsWith("-a="),
	);
}

async function main(): Promise<void> {
	// Construct the logger before any fallible startup work so the catch
	// block can use it uniformly. parseLogLevel guards against typos in
	// CUEKIT_LOG_LEVEL (unknown values fall back to "warn" instead of
	// silently enabling every level).
	const logLevel = parseLogLevel(process.env.CUEKIT_LOG_LEVEL);
	const logger = createStderrLogger({ minLevel: logLevel });

	let db: Database | undefined;
	try {
		const isTui = process.argv[2] === "tui";
		if (isTui && (process.argv.includes("--help") || process.argv.includes("-h"))) {
			printTuiHelp();
			return;
		}

		const isMcpAdd = process.argv[2] === "mcp" && process.argv[3] === "add";
		const mcpAddArgs = process.argv.slice(4);
		const piAgents = splitPiAgentArgs(mcpAddArgs);
		if (isMcpAdd && piAgents.hasPi) {
			const result = registerPiMcpServer({
				global: !piAgents.rest.includes("--no-global"),
			});
			process.stdout.write(`Registered MCP server '${result.serverName}' for Pi: ${result.path}\n`);
			if (!hasExplicitAgent(piAgents.rest)) return;
		}

		// Allow integration tests and operators to point at an alternate DB
		// path via CUEKIT_DB_PATH. Unset or empty string → `~/.cuekit/state.db`
		// (production default). Accepts `:memory:` too if someone really
		// wants an ephemeral server.
		const dbPath = process.env.CUEKIT_DB_PATH;
		const useCustomPath = dbPath !== undefined && dbPath.length > 0;
		db = openDatabase(useCustomPath ? { path: dbPath } : {});
		runMigrations(db);

		const panes = new PaneBackend();
		const registry = new AdapterRegistry();
		registry.register(createClaudeCodeAdapter(db, panes, { logger }));
		registry.register(createPiAdapter(db, panes, { logger }));
		registry.register(createOpenCodeAdapter(db, panes, { logger }));

		if (isTui) {
			const { runTui } = await import(TUI_PACKAGE_NAME);
			const all = process.argv.includes("--all");
			const pathScope = process.argv.includes("--path");
			const projectRoot = findProjectRoot(process.cwd(), { existsSync, statSync });
			const loadedConfig = all || pathScope ? undefined : loadProjectConfig(process.cwd());
			if (loadedConfig && !loadedConfig.ok) {
				throw new Error(loadedConfig.error);
			}
			await runTui(
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
				),
			);
			closeQuietly(db);
			return;
		}

		installSignalHandlers(db);

		const isMcpServer = process.argv.includes("--mcp");
		const isMcpConfig = process.argv[2] === "mcp" && process.argv[3] === "config";
		const cli = isMcpServer
			? createMcpCli({ db, registry })
			: isMcpConfig
				? createMcpConfigCli({ db, registry })
				: createCli({ db, registry });
		// Note: `cli.serve()` may return before the process should exit —
		// in `--mcp` mode incur resolves this promise as soon as the stdio
		// transport is wired, and the server keeps handling requests in
		// the background. Closing the DB here would break subsequent tool
		// calls with 'Cannot use a closed database'. Defer cleanup to the
		// signal handlers instead; the OS reclaims everything on exit.
		const argv = isMcpConfig
			? ["config", ...process.argv.slice(4)]
			: isMcpAdd && piAgents.hasPi
				? ["mcp", "add", ...piAgents.rest]
				: undefined;
		await cli.serve(argv);
	} catch (err) {
		if (db) closeQuietly(db);
		logger.error("startup failed", {
			reason: err instanceof Error ? err.message : String(err),
		});
		process.exit(1);
	}
}

await main();
