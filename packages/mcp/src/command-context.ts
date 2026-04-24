import type { Database } from "bun:sqlite";
import type { AdapterRegistry, PaneBackend } from "@cuekit/adapters";

export interface CommandContext {
	db: Database;
	panes: PaneBackend;
	registry: AdapterRegistry;
}
