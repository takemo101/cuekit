import type { Database } from "bun:sqlite";
import type { TaskSpec } from "@cuekit/core";
import type { AgentAdapter } from "./agent-adapter.ts";
import { createPaneAdapter } from "./pane-adapter.ts";
import type { PaneBackend } from "./pane-backend.ts";
import { shellQuote } from "./shell-quote.ts";

export interface ClaudeCodeAdapterOptions {
	// For tests / sandboxing: replace the launch command builder entirely. The
	// default shells out to the `claude` CLI with the objective as a prompt.
	launchCommandOverride?: (spec: TaskSpec) => string;
	// Override the binary used by the default builder.
	claudeBin?: string;
	// Advertised models. Defaults to Anthropic's current code-targeted set.
	availableModels?: string[];
}

export function createClaudeCodeAdapter(
	db: Database,
	panes: PaneBackend,
	options: ClaudeCodeAdapterOptions = {},
): AgentAdapter {
	const claudeBin = options.claudeBin ?? "claude";
	const availableModels = options.availableModels ?? ["haiku", "sonnet", "opus"];

	function buildLaunchCommand(spec: TaskSpec): string {
		const parts: string[] = [claudeBin];
		if (spec.model) {
			parts.push("--model", spec.model);
		}
		// Claude Code accepts an initial prompt as a positional argument.
		// Interactive mode stays attached to the TTY so `tmux attach-session`
		// can foreground the live child. No `-p`/`--print` (that would be
		// headless).
		parts.push(shellQuote(spec.objective));
		return parts.join(" ");
	}

	return createPaneAdapter(
		{
			kind: "claude-code",
			capabilities: {
				agent_kind: "claude-code",
				supports_steering: true,
				supports_attach: true,
				supports_model_selection: true,
				available_models: availableModels,
				supports_artifacts: true,
				supports_live_progress: false,
			},
			buildLaunchCommand: options.launchCommandOverride ?? buildLaunchCommand,
		},
		{ db, panes },
	);
}
