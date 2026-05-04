import type { Database } from "bun:sqlite";
import type { Logger, TaskSpec } from "@cuekit/core";
import { adapterRunModeFor, shouldDangerouslySkipPermissions } from "./adapter-options.ts";
import type { AgentAdapter } from "./agent-adapter.ts";
import { createPaneAdapter } from "./pane-adapter.ts";
import type { PaneBackend } from "./pane-backend.ts";
import { shellQuote } from "./shell-quote.ts";
import { renderTaskSpecPrompt } from "./task-spec-prompt.ts";

export interface ClaudeCodeAdapterOptions {
	// For tests / sandboxing: replace the launch command builder entirely. The
	// default shells out to the `claude` CLI with the objective as a prompt.
	launchCommandOverride?: (spec: TaskSpec) => string;
	// Override the binary used by the default builder.
	claudeBin?: string;
	// Advertised models. Defaults to Anthropic's current code-targeted set.
	availableModels?: string[];
	// Optional logger forwarded to the shared pane adapter. Defaults silent.
	logger?: Logger;
	// Override cuekit's home dir (default `~/.cuekit/`). Used as the
	// fallback location for the exit-code sentinel when the worktree
	// is unwritable. Tests set this to a tmpdir.
	cuekitHomeDir?: string;
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
	panes: PaneBackend,
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
		{ db, panes, logger: options.logger, cuekitHomeDir: options.cuekitHomeDir },
	);
}
