import type { TaskSpec } from "@cuekit/core";

const CHILD_REPORTING_CONTRACT = `Child reporting contract:
- Prefer the MCP tool report_task_event for progress and terminal reports.
- If MCP is unavailable, use the CLI fallback: cuekit tool report --type <progress|completed|failed|blocked|help_requested|log> --message "...".
- CUEKIT_TASK_ID and CUEKIT_CHILD_TOKEN are already provided in your environment; do not print or store the token.
- Report progress when useful, and report completed, failed, or blocked before you finish.
- Use help_requested when parent input is needed and you can remain resumable.
- transcript markers and direct result.json writes are not the canonical reporting path; SQLite task_events written by report_task_event / cuekit tool report are canonical.
- Reporting does not automatically close your pane or process; finish normally after reporting.`;

function renderTeamContext(spec: TaskSpec): string | undefined {
	const team = spec.team_context;
	if (!team) return undefined;
	const header = `cuekit team ${team.team_id}: ${team.title}${team.objective ? ` — ${team.objective}` : ""}`;
	const preamble =
		"Team context:\nThis team context is supplemental; follow your agent profile and role instructions first if there is any conflict.";
	if (team.position === "coordinator") {
		return `${preamble}\nYou are the coordinator for ${header}.\nUse cuekit MCP tools such as get_team_status, wait_team, get_task_result, submit_team_tasks, and steer_task to inspect team status, wait for workers, inspect task results, submit follow-up team tasks if needed, and steer workers when they are blocked or off-scope.\nYou are expected to run in the same coding-agent runtime as the caller/orchestrator, or another runtime with equivalent cuekit MCP access.\nDo not micromanage workers unnecessarily. Do not cleanup tasks unless explicitly requested.`;
	}
	if (team.position === "worker") {
		return `${preamble}\nYou are a worker in ${header}.\nFocus on your assigned objective. A coordinator may inspect your status/result or steer you if needed.\nReport progress and completion through cuekit reporting as usual.`;
	}
	if (team.position === "reviewer") {
		return `${preamble}\nYou are a reviewer in ${header}.\nReview the relevant team outputs or final combined changes. Prefer concrete findings with task/file references.`;
	}
	if (team.position === "observer") {
		return `${preamble}\nYou are an observer in ${header}.\nMonitor or summarize as requested without taking ownership of implementation.`;
	}
	return `${preamble}\nYou are part of ${header}.\nCoordinate through the parent/coordinator when necessary and report your outcome clearly.`;
}

export function renderTaskSpecPrompt(spec: TaskSpec): string {
	const sections: string[] = [spec.objective];

	if (spec.context) {
		sections.push(`Context:\n${spec.context}`);
	}

	if (spec.role && spec.role_instructions) {
		const source = spec.role_source ? ` (${spec.role_source})` : "";
		sections.push(`Agent profile: ${spec.role}${source}\n${spec.role_instructions}`);
	}

	const teamContext = renderTeamContext(spec);
	if (teamContext) {
		sections.push(teamContext);
	}

	if (spec.constraints && spec.constraints.length > 0) {
		sections.push(`Constraints:\n${spec.constraints.map((c) => `- ${c}`).join("\n")}`);
	}

	if (spec.inputs && spec.inputs.length > 0) {
		sections.push(`Inputs:\n${JSON.stringify(spec.inputs, null, 2)}`);
	}

	if (spec.expected_output) {
		sections.push(`Expected output:\n${JSON.stringify(spec.expected_output, null, 2)}`);
	}

	sections.push(CHILD_REPORTING_CONTRACT);

	return sections.join("\n\n");
}
