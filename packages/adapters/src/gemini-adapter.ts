import type { Database } from "bun:sqlite";
import type { Logger, TaskSpec } from "@cuekit/core";
import { adapterRunModeFor, shouldDangerouslySkipPermissions } from "./adapter-options.ts";
import type { AgentAdapter } from "./agent-adapter.ts";
import { createPaneAdapter } from "./pane-adapter.ts";
import type { PaneBackend } from "./pane-backend.ts";
import { shellQuote } from "./shell-quote.ts";
import { renderTaskSpecPrompt } from "./task-spec-prompt.ts";

export interface GeminiAdapterOptions {
	// For tests / sandboxing: replace the launch command builder entirely.
	launchCommandOverride?: (spec: TaskSpec) => string;
	// Override the binary used by the default builder.
	geminiBin?: string;
	// Advertised models. Defaults to Google's current code-targeted set.
	availableModels?: string[];
	// Optional logger forwarded to the shared pane adapter. Defaults silent.
	logger?: Logger;
	// Override cuekit's home dir (default `~/.cuekit/`). Used as the
	// fallback location for the exit-code sentinel when the worktree is
	// unwritable. Tests set this to a tmpdir.
	cuekitHomeDir?: string;
}

export interface BuildGeminiLaunchCommandOptions {
	geminiBin?: string;
}

// Pure builder for the tmux-pane launch command. Output is a single
// shell-command string (tmux new-session receives it as its final
// positional argument).
//
// Shape:
//   <bin> --skip-trust [-y] [-m '<model>'] '<prompt>'           (interactive)
//   <bin> --skip-trust [-y] [-m '<model>'] -p '<prompt>'        (batch)
//
// `--skip-trust` is added unconditionally so unattended panes never
// stall on Gemini's trusted-folder gate (which, unlike Claude Code,
// is not auto-skipped in non-TTY mode). The `-y` (yolo) flag is
// added when `shouldDangerouslySkipPermissions(spec)` is true,
// which is the default; explicit `dangerously_skip_permissions:
// false` removes it but leaves `--skip-trust` in place.
//
// Interactive mode passes the prompt as a positional argument so
// the REPL stays attached to the TTY. Batch mode passes the prompt
// as the value of `-p` and Gemini exits after one turn.
export function buildGeminiLaunchCommand(
	spec: TaskSpec,
	options: BuildGeminiLaunchCommandOptions = {},
): string {
	const bin = options.geminiBin ?? "gemini";
	const parts: string[] = [bin, "--skip-trust"];
	if (shouldDangerouslySkipPermissions(spec)) {
		parts.push("-y");
	}
	if (spec.model) {
		parts.push("-m", shellQuote(spec.model));
	}
	const prompt = shellQuote(renderTaskSpecPrompt(spec));
	if (adapterRunModeFor(spec) === "batch") {
		parts.push("-p", prompt);
	} else {
		parts.push(prompt);
	}
	return parts.join(" ");
}

export function createGeminiAdapter(
	db: Database,
	panes: PaneBackend,
	options: GeminiAdapterOptions = {},
): AgentAdapter {
	const availableModels = options.availableModels ?? [
		"gemini-2.5-pro",
		"gemini-2.5-flash",
		"gemini-2.5-flash-lite",
	];
	const builder =
		options.launchCommandOverride ??
		((spec: TaskSpec) => buildGeminiLaunchCommand(spec, { geminiBin: options.geminiBin }));

	return createPaneAdapter(
		{
			kind: "gemini",
			capabilities: {
				agent_kind: "gemini",
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
