#!/usr/bin/env bun
import {
	AdapterRegistry,
	createClaudeCodeAdapter,
	createOpenCodeAdapter,
	createPiAdapter,
	PaneBackend,
} from "@cuekit/adapters";
import { openDatabase, runMigrations } from "@cuekit/store";
import { createCli } from "./cli.ts";

// Default cuekit entry point: opens ~/.cuekit/state.db, migrates, wires the
// tmux pane backend + all three adapters, and hands argv to incur.
// `cuekit --mcp` flips incur into stdio MCP server mode; `cuekit <command>`
// runs the command once from the CLI.
const db = openDatabase();
runMigrations(db);
const panes = new PaneBackend();
const registry = new AdapterRegistry();
registry.register(createClaudeCodeAdapter(db, panes));
registry.register(createPiAdapter(db, panes));
registry.register(createOpenCodeAdapter(db, panes));

const cli = createCli({ db, panes, registry });
await cli.serve();
