import type { Database } from "bun:sqlite";
import type { HooksConfig, Logger } from "@cuekit/core";
import { AdapterRegistry } from "./adapter-registry.ts";
import { createClaudeCodeAdapter } from "./claude-code-adapter.ts";
import { createGeminiAdapter } from "./gemini-adapter.ts";
import { HookDispatcher } from "./hook-dispatcher.ts";
import { createJcodeAdapter } from "./jcode-adapter.ts";
import type { MultiplexerBackend } from "./multiplexer-backend.ts";
import { createOpenCodeAdapter } from "./opencode-adapter.ts";
import { createPiAdapter } from "./pi-adapter.ts";

// Build the AdapterRegistry that every cuekit entrypoint should expose
// to its adapter consumers. Both the MCP server (`cuekit --mcp`) and the
// human TUI (`cuekit tui`) call this so they cannot drift on which
// adapters are registered — the gemini-not-attachable-from-TUI bug fixed
// in #375 / #380 was caused by hand-maintained twin registries.
//
// The factory is the single place that knows the canonical adapter set.
// Adding a new adapter (e.g. a sixth runtime) now means one
// `registry.register(...)` line here, picked up automatically by every
// caller. Per-binary hooks (e.g. an MCP-only adapter, or a TUI-only
// stub) should NOT be added back here — keep this list canonical and
// build per-binary registries only if a real divergent need appears.
export interface BuildAdapterRegistryOptions {
	logger?: Logger;
	hooks?: HooksConfig;
}

export function buildAdapterRegistry(
	db: Database,
	panes: MultiplexerBackend,
	options: BuildAdapterRegistryOptions = {},
): AdapterRegistry {
	const { logger, hooks } = options;
	const dispatcher = hooks ? new HookDispatcher(hooks, logger) : undefined;
	const registry = new AdapterRegistry();
	registry.register(createClaudeCodeAdapter(db, panes, { logger, hooks: dispatcher }));
	registry.register(createPiAdapter(db, panes, { logger, hooks: dispatcher }));
	registry.register(createOpenCodeAdapter(db, panes, { logger, hooks: dispatcher }));
	registry.register(createJcodeAdapter(db, panes, { logger, hooks: dispatcher }));
	registry.register(createGeminiAdapter(db, panes, { logger, hooks: dispatcher }));
	return registry;
}
