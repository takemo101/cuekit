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
	const prompt = shellQuote(renderTaskSpecPrompt(spec));
	return [
		'fifo="' + "$" + "{TMPDIR:-/tmp}" + '/cuekit-jcode-$$";',
		'rm -f "$fifo";',
		'mkfifo "$fifo"',
		"&&",
		`{ (printf '%s\\n' ${prompt}; cat < /dev/tty) > "$fifo" & feeder_pid=$!;`,
		`${parts.join(" ")} < "$fifo";`,
		"status=$?;",
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
