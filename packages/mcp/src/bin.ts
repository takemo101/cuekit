#!/usr/bin/env bun
import type { Database } from "bun:sqlite";
import { buildAdapterRegistry, TmuxBackend } from "@cuekit/adapters";
import { createStderrLogger, parseLogLevel } from "@cuekit/core";
import { openDatabase, runMigrations } from "@cuekit/store";
import { createCli, createMcpCli, createMcpConfigCli } from "./cli.ts";

// Default cuekit entry point: opens ~/.cuekit/state.db, migrates, wires the
// tmux pane backend + all built-in adapters, and hands argv to incur.
// `cuekit --mcp` flips incur into stdio MCP server mode; `cuekit <command>`
// runs the command once from the CLI.

function closeQuietly(db: Database): void {
	try {
		db.close();
	} catch {
		// ignore close errors on shutdown
	}
}

function printMainHelp(): void {
	process.stdout.write(
		[
			"cuekit — delegation substrate for coding agents",
			"",
			"Usage: cuekit <command> [options]",
			"",
			"Human-only commands:",
			"  cuekit init  Create .cuekit.yaml and update .gitignore",
			"  cuekit tui   Open the interactive task cockpit",
			"",
			"Command groups:",
			"  task, team, adapter, agent, session, tool, mcp",
			"",
			"Use 'cuekit init --help' or 'cuekit tui --help' for human-only command help.",
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

function findStrategyShowPositional(rest: string[]): { value: string; index: number } | undefined {
	const optionsWithValues = new Set(["--format", "--cwd", "--strategy", "--objective"]);
	for (let index = 0; index < rest.length; index++) {
		const arg = rest[index];
		if (arg === undefined) continue;
		if (arg.startsWith("--strategy=")) return undefined;
		if (optionsWithValues.has(arg)) {
			index++;
			continue;
		}
		if (arg.startsWith("-")) continue;
		return { value: arg, index };
	}
	return undefined;
}

function normalizeCuekitArgv(): string[] | undefined {
	if (process.argv[2] === "strategy" && process.argv[3] === "show") {
		const rest = process.argv.slice(4);
		const positional = findStrategyShowPositional(rest);
		if (positional && !rest.some((arg) => arg === "--strategy" || arg.startsWith("--strategy="))) {
			return [
				"strategy",
				"show",
				"--strategy",
				positional.value,
				...rest.filter((_, index) => index !== positional.index),
			];
		}
	}
	return undefined;
}

export async function runCuekitMcpBin(): Promise<void> {
	// Construct the logger before any fallible startup work so the catch
	// block can use it uniformly. parseLogLevel guards against typos in
	// CUEKIT_LOG_LEVEL (unknown values fall back to "warn" instead of
	// silently enabling every level).
	const logLevel = parseLogLevel(process.env.CUEKIT_LOG_LEVEL);
	const logger = createStderrLogger({ minLevel: logLevel });

	let db: Database | undefined;
	try {
		if (process.argv[2] === "--help" || process.argv[2] === "-h") {
			printMainHelp();
			return;
		}

		// Allow integration tests and operators to point at an alternate DB
		// path via CUEKIT_DB_PATH. Unset or empty string → `~/.cuekit/state.db`
		// (production default). Accepts `:memory:` too if someone really
		// wants an ephemeral server.
		const dbPath = process.env.CUEKIT_DB_PATH;
		const useCustomPath = dbPath !== undefined && dbPath.length > 0;
		db = openDatabase(useCustomPath ? { path: dbPath } : {});
		runMigrations(db);

		const panes = new TmuxBackend();
		const registry = buildAdapterRegistry(db, panes, { logger });

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
		const argv = isMcpConfig ? ["config", ...process.argv.slice(4)] : normalizeCuekitArgv();
		await cli.serve(argv);
	} catch (err) {
		if (db) closeQuietly(db);
		logger.error("startup failed", {
			reason: err instanceof Error ? err.message : String(err),
		});
		process.exit(1);
	}
}

if (import.meta.main) {
	await runCuekitMcpBin();
}
