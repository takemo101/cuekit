import type { Database } from "bun:sqlite";
import type { Logger, TaskSpec } from "@cuekit/core";
import type { AgentAdapter } from "./agent-adapter.ts";
import { createPaneAdapter } from "./pane-adapter.ts";
import type { PaneBackend } from "./pane-backend.ts";
import { shellQuote } from "./shell-quote.ts";

// Truthful stub: placeholder OpenCode CLI invocation. Capabilities match the
// spec's adapter matrix (state-dependent steering, model selection via
// --model). Model list is left unset because OpenCode's model catalog is
// runtime-configurable and cuekit should defer validation.
export interface OpenCodeAdapterOptions {
	launchCommandOverride?: (spec: TaskSpec) => string;
	openCodeBin?: string;
	logger?: Logger;
}

export function createOpenCodeAdapter(
	db: Database,
	panes: PaneBackend,
	options: OpenCodeAdapterOptions = {},
): AgentAdapter {
	const bin = options.openCodeBin ?? "opencode";

	function buildLaunchCommand(spec: TaskSpec): string {
		const parts: string[] = [bin, "run"];
		if (spec.model) {
			parts.push("--model", spec.model);
		}
		parts.push("--prompt", shellQuote(spec.objective));
		return parts.join(" ");
	}

	return createPaneAdapter(
		{
			kind: "opencode",
			capabilities: {
				agent_kind: "opencode",
				supports_steering: true,
				supports_attach: true,
				supports_model_selection: true,
				supports_artifacts: true,
				supports_live_progress: true,
			},
			buildLaunchCommand: options.launchCommandOverride ?? buildLaunchCommand,
		},
		{ db, panes, logger: options.logger },
	);
}
