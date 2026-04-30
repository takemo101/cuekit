import type { Database } from "bun:sqlite";
import type { Logger, TaskSpec } from "@cuekit/core";
import { shouldDangerouslySkipPermissions } from "./adapter-options.ts";
import type { AgentAdapter } from "./agent-adapter.ts";
import { createPaneAdapter } from "./pane-adapter.ts";
import type { PaneBackend } from "./pane-backend.ts";
import { shellQuote } from "./shell-quote.ts";
import { renderTaskSpecPrompt } from "./task-spec-prompt.ts";

// Truthful stub: placeholder OpenCode CLI invocation. Capabilities match the
// spec's adapter matrix (state-dependent steering, model selection via
// --model). Model list is left unset because OpenCode's model catalog is
// runtime-configurable and cuekit should defer validation.
export interface OpenCodeAdapterOptions {
	launchCommandOverride?: (spec: TaskSpec) => string;
	openCodeBin?: string;
	logger?: Logger;
	cuekitHomeDir?: string;
}

export function buildOpenCodeLaunchCommand(spec: TaskSpec, openCodeBin = "opencode"): string {
	const parts: string[] = [openCodeBin, "run"];
	if (shouldDangerouslySkipPermissions(spec)) {
		parts.push("--dangerously-skip-permissions");
	}
	if (spec.model) {
		parts.push("--model", shellQuote(spec.model));
	}
	parts.push("--", shellQuote(renderTaskSpecPrompt(spec)));
	return parts.join(" ");
}

export function createOpenCodeAdapter(
	db: Database,
	panes: PaneBackend,
	options: OpenCodeAdapterOptions = {},
): AgentAdapter {
	const bin = options.openCodeBin ?? "opencode";

	return createPaneAdapter(
		{
			kind: "opencode",
			capabilities: {
				agent_kind: "opencode",
				supports_steering: true,
				supports_attach: true,
				supports_model_selection: true,
				supports_artifacts: true,
				supports_live_progress: false,
			},
			buildLaunchCommand:
				options.launchCommandOverride ?? ((spec) => buildOpenCodeLaunchCommand(spec, bin)),
		},
		{ db, panes, logger: options.logger, cuekitHomeDir: options.cuekitHomeDir },
	);
}
