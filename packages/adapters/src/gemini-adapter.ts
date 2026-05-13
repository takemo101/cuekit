import type { Database } from "bun:sqlite";
import type { Logger, TaskSpec } from "@cuekit/core";
import { adapterRunModeFor, shouldDangerouslySkipPermissions } from "./adapter-options.ts";
import type { AgentAdapter } from "./agent-adapter.ts";
import type { HookDispatcher } from "./hook-dispatcher.ts";
import type { MultiplexerBackend } from "./multiplexer-backend.ts";
import { createPaneAdapter } from "./pane-adapter.ts";
import { shellQuote } from "./shell-quote.ts";
import { renderTaskSpecPrompt } from "./task-spec-prompt.ts";

export interface GeminiAdapterOptions {
	launchCommandOverride?: (spec: TaskSpec) => string;
	geminiBin?: string;
	availableModels?: string[];
	logger?: Logger;
	cuekitHomeDir?: string;
	hooks?: HookDispatcher;
}

export interface BuildGeminiLaunchCommandOptions {
	geminiBin?: string;
}

// The four values Gemini's `--approval-mode` flag accepts.
const APPROVAL_MODES = ["default", "auto_edit", "yolo", "plan"] as const;
type GeminiApprovalMode = (typeof APPROVAL_MODES)[number];

// Read `adapter_options.approval_mode` and validate against the
// known enum. Unknown / non-string values fall through to undefined
// so the binary `dangerously_skip_permissions` path still applies —
// invalid input must not silently produce a malformed launch command.
function approvalModeFor(spec: TaskSpec): GeminiApprovalMode | undefined {
	const value = spec.adapter_options?.approval_mode;
	return typeof value === "string" && (APPROVAL_MODES as readonly string[]).includes(value)
		? (value as GeminiApprovalMode)
		: undefined;
}

// Pure builder for the tmux-pane launch command. Output is a single
// shell-command string (tmux new-session receives it as its final
// positional argument).
//
// Shape:
//   <bin> --skip-trust [--approval-mode '<mode>' | -y] [-m '<model>'] '<prompt>'           (interactive)
//   <bin> --skip-trust [--approval-mode '<mode>' | -y] [-m '<model>'] -p '<prompt>'        (batch)
//
// `--skip-trust` is added unconditionally so unattended panes never
// stall on Gemini's trusted-folder gate (which, unlike Claude Code,
// is not auto-skipped in non-TTY mode).
//
// Permission semantics:
// - When `adapter_options.approval_mode` is one of the four valid
//   values (`default` / `auto_edit` / `yolo` / `plan`), emit
//   `--approval-mode <value>` directly and skip the `-y` shortcut —
//   the explicit value wins over the binary
//   `dangerously_skip_permissions` toggle.
// - Otherwise fall back to the binary path: add `-y` when
//   `shouldDangerouslySkipPermissions(spec)` is true (default).
// `--approval-mode plan` is the API-level read-only mode useful for
// reviewer-style children that must not be able to edit files.
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
	const approvalMode = approvalModeFor(spec);
	if (approvalMode !== undefined) {
		parts.push("--approval-mode", shellQuote(approvalMode));
	} else if (shouldDangerouslySkipPermissions(spec)) {
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
	panes: MultiplexerBackend,
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
		{
			db,
			panes,
			logger: options.logger,
			cuekitHomeDir: options.cuekitHomeDir,
			hooks: options.hooks,
		},
	);
}
