import type { Database } from "bun:sqlite";
import type { Logger, TaskSpec } from "@cuekit/core";
import type { AgentAdapter } from "./agent-adapter.ts";
import { createPaneAdapter } from "./pane-adapter.ts";
import type { PaneBackend } from "./pane-backend.ts";
import { shellQuote } from "./shell-quote.ts";
import { renderTaskSpecPrompt } from "./task-spec-prompt.ts";

export interface JcodeAdapterOptions {
	launchCommandOverride?: (spec: TaskSpec) => string;
	jcodeBin?: string;
	logger?: Logger;
	cuekitHomeDir?: string;
}

export interface BuildJcodeReplLaunchCommandOptions {
	jcodeBin?: string;
}

function providerProfileFor(spec: TaskSpec): string | undefined {
	const value = spec.adapter_options?.provider_profile;
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function shellDefaultExpansion(variable: string, fallback: string): string {
	return `\${${variable}:-${fallback}}`;
}

function renderJcodePrompt(spec: TaskSpec): string {
	return `${renderTaskSpecPrompt(spec)}

Jcode adapter guidance:
- Run validation commands in the foreground with enough timeout so you can read their final output.
- If a validation command that is expected to terminate starts in the background, wait for and inspect that result before deciding success.
- For intentionally long-running background commands such as dev servers or watchers, inspect current status/output instead of waiting for completion.
- Report completed, failed, or blocked through cuekit before exiting.`;
}

export function buildJcodeReplLaunchCommand(
	spec: TaskSpec,
	options: BuildJcodeReplLaunchCommandOptions = {},
): string {
	const bin = shellQuote(options.jcodeBin ?? "jcode");
	const parts = [bin, "repl", "--no-update"];
	const providerProfile = providerProfileFor(spec);
	if (providerProfile) {
		parts.push("--provider-profile", shellQuote(providerProfile));
	}
	if (spec.model) {
		parts.push("--model", shellQuote(spec.model));
	}
	const prompt = shellQuote(renderJcodePrompt(spec));
	const tmpDirExpansion = shellDefaultExpansion("TMPDIR", "/tmp");
	const jcodeHomeExpansion = shellDefaultExpansion("JCODE_HOME", "$HOME/.jcode");
	return [
		`fifo="${tmpDirExpansion}/cuekit-jcode-$$";`,
		'rm -f "$fifo";',
		'mkfifo "$fifo"',
		"&&",
		`{ (printf '%s\\n' ${prompt}; cat < /dev/tty) > "$fifo" & feeder_pid=$!;`,
		`${parts.join(" ")} < "$fifo" & jcode_pid=$!;`,
		'wait "$jcode_pid";',
		"status=$?;",
		// jcode v0.11.x marks `repl` sessions active in ~/.jcode/active_pids,
		// but does not mark them closed when the REPL exits normally. Remove the
		// PID marker owned by this cuekit-managed REPL so the next plain `jcode`
		// launch does not auto-restore it as an unexpected shutdown.
		`jcode_home="${jcodeHomeExpansion}";`,
		'if [ -d "$jcode_home/active_pids" ]; then for pid_file in "$jcode_home"/active_pids/*; do [ -f "$pid_file" ] || continue; if [ "$(cat "$pid_file" 2>/dev/null)" = "$jcode_pid" ]; then rm -f "$pid_file"; fi; done; fi;',
		'kill "$feeder_pid" 2>/dev/null;',
		'wait "$feeder_pid" 2>/dev/null;',
		'rm -f "$fifo";',
		'exit "$status"; }',
	].join(" ");
}

export function createJcodeAdapter(
	db: Database,
	panes: PaneBackend,
	options: JcodeAdapterOptions = {},
): AgentAdapter {
	const builder =
		options.launchCommandOverride ??
		((spec: TaskSpec) => buildJcodeReplLaunchCommand(spec, { jcodeBin: options.jcodeBin }));

	return createPaneAdapter(
		{
			kind: "jcode",
			capabilities: {
				agent_kind: "jcode",
				supports_steering: true,
				supports_attach: true,
				supports_model_selection: true,
				supports_artifacts: true,
				supports_live_progress: false,
			},
			buildLaunchCommand: builder,
		},
		{ db, panes, logger: options.logger, cuekitHomeDir: options.cuekitHomeDir },
	);
}
