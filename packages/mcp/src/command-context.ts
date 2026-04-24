import type { Database } from "bun:sqlite";
import type { AdapterRegistry } from "@cuekit/adapters";

// Minimum shared state commands need. Note that individual adapters already
// close over their `PaneBackend` inside the registry — the control surface
// does not need a separate reference.
export interface CommandContext {
	db: Database;
	registry: AdapterRegistry;
}
