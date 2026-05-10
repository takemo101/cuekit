import type { Database } from "bun:sqlite";
import type { AdapterRegistry, MultiplexerBackend } from "@cuekit/adapters";

// Minimum shared state commands need. Adapters close over their backend
// inside the registry, but the TUI needs a separate reference for direct
// pane capture (the live transcript pane reads `capturePane` to render the
// rendered screen of running tasks).
export interface CommandContext {
	db: Database;
	registry: AdapterRegistry;
	panes?: MultiplexerBackend;
}
