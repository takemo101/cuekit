#!/usr/bin/env bun
import type { Database } from "bun:sqlite";
import {
	AdapterRegistry,
	createClaudeCodeAdapter,
	createOpenCodeAdapter,
	createPiAdapter,
	PaneBackend,
} from "@cuekit/adapters";
import { createStderrLogger, parseLogLevel } from "@cuekit/core";
import { openDatabase, runMigrations } from "@cuekit/store";
import { createCli, createMcpCli, createMcpConfigCli } from "./cli.ts";
import { registerPiMcpServer } from "./pi-mcp-config.ts";
import { printTuiHelp, runTui } from "./tui/index.tsx";

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
		installSignalHandlers(db);

		const panes = new PaneBackend();
		const registry = new AdapterRegistry();
		registry.register(createClaudeCodeAdapter(db, panes, { logger }));
		registry.register(createPiAdapter(db, panes, { logger }));
		registry.register(createOpenCodeAdapter(db, panes, { logger }));

		if (isTui) {
			await runTui({ db, registry });
			return;
		}

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
