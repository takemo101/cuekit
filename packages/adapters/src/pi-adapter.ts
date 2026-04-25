import type { Database } from "bun:sqlite";
import type { Logger, TaskSpec } from "@cuekit/core";
import type { AgentAdapter } from "./agent-adapter.ts";
import { createPaneAdapter } from "./pane-adapter.ts";
import type { PaneBackend } from "./pane-backend.ts";
import { shellQuote } from "./shell-quote.ts";
import { renderTaskSpecPrompt } from "./task-spec-prompt.ts";

// Truthful stub: wiring is in place via the shared pane backend, but the
// concrete pi CLI invocation is a placeholder until verified against the
// actual runtime. Callers get an honest adapter that spawns pi in a tmux
// pane; model selection is declared false until the pi CLI shape is known.
export interface PiAdapterOptions {
	launchCommandOverride?: (spec: TaskSpec) => string;
	piBin?: string;
	logger?: Logger;
	cuekitHomeDir?: string;
}

export function createPiAdapter(
	db: Database,
	panes: PaneBackend,
	options: PiAdapterOptions = {},
): AgentAdapter {
	const piBin = options.piBin ?? "pi";

	function buildLaunchCommand(spec: TaskSpec): string {
		return `${piBin} ${shellQuote(renderTaskSpecPrompt(spec))}`;
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
				supports_live_progress: false,
			},
			buildLaunchCommand: options.launchCommandOverride ?? buildLaunchCommand,
		},
		{ db, panes, logger: options.logger, cuekitHomeDir: options.cuekitHomeDir },
	);
}
