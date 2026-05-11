import type { Database } from "bun:sqlite";
import type { Logger, TaskSpec } from "@cuekit/core";
import { adapterRunModeFor } from "./adapter-options.ts";
import type { AgentAdapter } from "./agent-adapter.ts";
import type { MultiplexerBackend } from "./multiplexer-backend.ts";
import { createPaneAdapter } from "./pane-adapter.ts";
import { shellQuote } from "./shell-quote.ts";
import { renderTaskSpecPrompt } from "./task-spec-prompt.ts";

// The pi CLI supports interactive mode with an initial prompt (`pi "..."`),
// non-interactive batch mode via `pi -p "..."`, and model selection via
// `pi --model <provider/model-or-pattern>`.
export interface PiAdapterOptions {
	launchCommandOverride?: (spec: TaskSpec) => string;
	piBin?: string;
	logger?: Logger;
	cuekitHomeDir?: string;
}

const PI_REPORTING_GUIDANCE = `Pi adapter guidance:
- This task is running under cuekit in a managed pane. Do not stop after only saying the answer.
- For single-shot objectives, after completing the requested work, run: cuekit tool report --type completed --message "<short summary>".
- If you cannot complete the task, run cuekit tool report with --type failed or --type blocked instead.`;

export function buildPiLaunchCommand(spec: TaskSpec, piBin = "pi"): string {
	const parts = [shellQuote(piBin)];
	if (spec.model) parts.push("--model", shellQuote(spec.model));
	const prompt = shellQuote(`${renderTaskSpecPrompt(spec)}\n\n${PI_REPORTING_GUIDANCE}`);
	return adapterRunModeFor(spec) === "batch"
		? `${parts.join(" ")} -p ${prompt}`
		: `${parts.join(" ")} ${prompt}`;
}

export function createPiAdapter(
	db: Database,
	panes: MultiplexerBackend,
	options: PiAdapterOptions = {},
): AgentAdapter {
	const piBin = options.piBin ?? "pi";

	return createPaneAdapter(
		{
			kind: "pi",
			capabilities: {
				agent_kind: "pi",
				supports_steering: true,
				supports_attach: true,
				supports_model_selection: true,
				supports_artifacts: true,
				supports_live_progress: false,
				default_mode: "interactive",
				supported_modes: ["interactive", "batch"],
			},
			buildLaunchCommand:
				options.launchCommandOverride ?? ((spec) => buildPiLaunchCommand(spec, piBin)),
		},
		{ db, panes, logger: options.logger, cuekitHomeDir: options.cuekitHomeDir },
	);
}
