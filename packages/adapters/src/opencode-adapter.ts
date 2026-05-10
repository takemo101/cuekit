import type { Database } from "bun:sqlite";
import type { Logger, TaskSpec } from "@cuekit/core";
import { adapterRunModeFor, shouldDangerouslySkipPermissions } from "./adapter-options.ts";
import type { AgentAdapter } from "./agent-adapter.ts";
import { createPaneAdapter } from "./pane-adapter.ts";
import type { PaneBackend } from "./tmux-backend.ts";
import { shellQuote } from "./shell-quote.ts";
import { renderTaskSpecPrompt } from "./task-spec-prompt.ts";

// OpenCode defaults to its interactive TUI entrypoint so attach and steering
// remain truthful. Non-interactive `opencode run` is available through
// `adapter_options.mode: "batch"` for short single-shot jobs.
export interface OpenCodeAdapterOptions {
	launchCommandOverride?: (spec: TaskSpec) => string;
	openCodeBin?: string;
	logger?: Logger;
	cuekitHomeDir?: string;
}

export function buildOpenCodeLaunchCommand(spec: TaskSpec, openCodeBin = "opencode"): string {
	return adapterRunModeFor(spec) === "batch"
		? buildOpenCodeRunLaunchCommand(spec, openCodeBin)
		: buildOpenCodeTuiLaunchCommand(spec, openCodeBin);
}

export function buildOpenCodeTuiLaunchCommand(spec: TaskSpec, openCodeBin = "opencode"): string {
	const parts: string[] = [shellQuote(openCodeBin)];
	if (spec.model) {
		parts.push("--model", shellQuote(spec.model));
	}
	parts.push("--prompt", shellQuote(renderTaskSpecPrompt(spec)));
	return parts.join(" ");
}

export function buildOpenCodeRunLaunchCommand(spec: TaskSpec, openCodeBin = "opencode"): string {
	const parts: string[] = [shellQuote(openCodeBin), "run"];
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
				default_mode: "interactive",
				supported_modes: ["interactive", "batch"],
			},
			buildLaunchCommand:
				options.launchCommandOverride ?? ((spec) => buildOpenCodeLaunchCommand(spec, bin)),
		},
		{ db, panes, logger: options.logger, cuekitHomeDir: options.cuekitHomeDir },
	);
}
