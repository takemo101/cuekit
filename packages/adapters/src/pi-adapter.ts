import type { Database } from "bun:sqlite";
import type { TaskSpec } from "@cuekit/core";
import type { AgentAdapter } from "./agent-adapter.ts";
import { createPaneAdapter } from "./pane-adapter.ts";
import type { PaneBackend } from "./pane-backend.ts";

// Truthful stub: wiring is in place via the shared pane backend, but the
// concrete pi CLI invocation is a placeholder until verified against the
// actual runtime. Callers get an honest adapter that spawns pi in a tmux
// pane; model selection is declared false until the pi CLI shape is known.
export interface PiAdapterOptions {
	launchCommandOverride?: (spec: TaskSpec) => string;
	piBin?: string;
}

export function createPiAdapter(
	db: Database,
	panes: PaneBackend,
	options: PiAdapterOptions = {},
): AgentAdapter {
	const piBin = options.piBin ?? "pi";

	function buildLaunchCommand(spec: TaskSpec): string {
		return `${piBin} ${shellQuote(spec.objective)}`;
	}

	return createPaneAdapter(
		{
			kind: "pi",
			capabilities: {
				agent_kind: "pi",
				supports_steering: true,
				supports_attach: true,
				supports_model_selection: false,
				supports_artifacts: true,
				supports_live_progress: true,
			},
			buildLaunchCommand: options.launchCommandOverride ?? buildLaunchCommand,
		},
		{ db, panes },
	);
}

function shellQuote(s: string): string {
	return `'${s.replace(/'/g, "'\\''")}'`;
}
