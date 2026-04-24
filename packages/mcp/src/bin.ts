#!/usr/bin/env bun
import type { Database } from "bun:sqlite";
import {
	AdapterRegistry,
	createClaudeCodeAdapter,
	createOpenCodeAdapter,
	createPiAdapter,
	PaneBackend,
} from "@cuekit/adapters";
import { createStderrLogger, type LogLevel } from "@cuekit/core";
import { openDatabase, runMigrations } from "@cuekit/store";
import { createCli } from "./cli.ts";

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

async function main(): Promise<void> {
	let db: Database | undefined;
	try {
		// Allow integration tests and operators to point at an alternate DB
		// path via CUEKIT_DB_PATH. Unset or empty string → `~/.cuekit/state.db`
		// (production default). Accepts `:memory:` too if someone really
		// wants an ephemeral server.
		const dbPath = process.env.CUEKIT_DB_PATH;
		const useCustomPath = dbPath !== undefined && dbPath.length > 0;
		db = openDatabase(useCustomPath ? { path: dbPath } : {});
		runMigrations(db);
		installSignalHandlers(db);

		// Structured stderr logger for warnings/errors. Level controllable via
		// CUEKIT_LOG_LEVEL (default "warn"). Adapters inherit it so operator-
		// visible warnings (e.g. 'transcript capture disabled') don't depend
		// on each adapter writing to stderr directly.
		const logLevel = (process.env.CUEKIT_LOG_LEVEL as LogLevel) ?? "warn";
		const logger = createStderrLogger({ minLevel: logLevel });

		const panes = new PaneBackend();
		const registry = new AdapterRegistry();
		registry.register(createClaudeCodeAdapter(db, panes, { logger }));
		registry.register(createPiAdapter(db, panes, { logger }));
		registry.register(createOpenCodeAdapter(db, panes, { logger }));

		const cli = createCli({ db, registry });
		// Note: `cli.serve()` may return before the process should exit —
		// in `--mcp` mode incur resolves this promise as soon as the stdio
		// transport is wired, and the server keeps handling requests in
		// the background. Closing the DB here would break subsequent tool
		// calls with 'Cannot use a closed database'. Defer cleanup to the
		// signal handlers instead; the OS reclaims everything on exit.
		await cli.serve();
	} catch (err) {
		if (db) closeQuietly(db);
		const message = err instanceof Error ? err.message : String(err);
		process.stderr.write(`cuekit: ${message}\n`);
		process.exit(1);
	}
}

await main();
