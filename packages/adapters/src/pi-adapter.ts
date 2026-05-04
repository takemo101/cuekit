import type { Database } from "bun:sqlite";
import type { Logger, TaskSpec } from "@cuekit/core";
import { adapterRunModeFor } from "./adapter-options.ts";
import type { AgentAdapter } from "./agent-adapter.ts";
import { createPaneAdapter } from "./pane-adapter.ts";
import type { PaneBackend } from "./pane-backend.ts";
import { shellQuote } from "./shell-quote.ts";
import { renderTaskSpecPrompt } from "./task-spec-prompt.ts";

// The pi CLI supports interactive mode with an initial prompt (`pi "..."`)
// and non-interactive batch mode via `pi -p "..."`. Model selection exists in
// the CLI, but this adapter keeps model selection disabled until cuekit grows a
// tested, documented provider/model mapping for pi.
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
	const command = shellQuote(piBin);
	const prompt = shellQuote(`${renderTaskSpecPrompt(spec)}\n\n${PI_REPORTING_GUIDANCE}`);
	return adapterRunModeFor(spec) === "batch" ? `${command} -p ${prompt}` : `${command} ${prompt}`;
}

export function createPiAdapter(
	db: Database,
	panes: PaneBackend,
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
				supports_model_selection: false,
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
