import type { Database } from "bun:sqlite";
import type { Logger, TaskSpec } from "@cuekit/core";
import { adapterRunModeFor, shouldDangerouslySkipPermissions } from "./adapter-options.ts";
import type { AgentAdapter } from "./agent-adapter.ts";
import { HookDispatcher } from "./hook-dispatcher.ts";
import type { MultiplexerBackend } from "./multiplexer-backend.ts";
import { createPaneAdapter } from "./pane-adapter.ts";
import { shellQuote } from "./shell-quote.ts";
import { renderTaskSpecPrompt } from "./task-spec-prompt.ts";

export interface ClaudeCodeAdapterOptions {
	launchCommandOverride?: (spec: TaskSpec) => string;
	claudeBin?: string;
	availableModels?: string[];
	logger?: Logger;
	cuekitHomeDir?: string;
	hooks?: HookDispatcher;
}

export interface BuildClaudeCodeLaunchCommandOptions {
	claudeBin?: string;
}

// Pure builder for the tmux-pane launch command. Exported so tests can pin
// the exact argv shape that will hit the `claude` CLI without having to spawn
// tmux or claude itself. The output is a single shell-command string (tmux
// new-session receives it as its final positional argument).
//
// Shape:    <claudeBin> [--dangerously-skip-permissions] [--model <model>] [-p] '<shell-quoted objective>'
// Example:  claude --dangerously-skip-permissions --model sonnet 'Implement retry logic'
//
// Interactive mode is the default (no -p / --print) — the pane stays attached
// to a TTY so `tmux attach-session` can foreground the live child. Batch mode
// uses Claude Code's verified `-p` non-interactive flag.
export function buildClaudeCodeLaunchCommand(
	spec: TaskSpec,
	options: BuildClaudeCodeLaunchCommandOptions = {},
): string {
	const bin = options.claudeBin ?? "claude";
	const parts: string[] = [bin];
	if (shouldDangerouslySkipPermissions(spec)) {
		parts.push("--dangerously-skip-permissions");
	}
	if (spec.model) {
		parts.push("--model", shellQuote(spec.model));
	}
	if (adapterRunModeFor(spec) === "batch") {
		parts.push("-p");
	}
	parts.push(shellQuote(renderTaskSpecPrompt(spec)));
	return parts.join(" ");
}

export function createClaudeCodeAdapter(
	db: Database,
	panes: MultiplexerBackend,
	options: ClaudeCodeAdapterOptions = {},
): AgentAdapter {
	const availableModels = options.availableModels ?? ["haiku", "sonnet", "opus"];
	// Pass `options.claudeBin` through untouched; the single default
	// lives inside `buildClaudeCodeLaunchCommand` so there's one source
	// of truth.
	const builder =
		options.launchCommandOverride ??
		((spec: TaskSpec) => buildClaudeCodeLaunchCommand(spec, { claudeBin: options.claudeBin }));

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
				default_mode: "interactive",
				supported_modes: ["interactive", "batch"],
			},
			buildLaunchCommand: builder,
		},
		{
			db,
			panes,
			logger: options.logger,
			cuekitHomeDir: options.cuekitHomeDir,
			hooks: options.hooks,
		},
	);
}
