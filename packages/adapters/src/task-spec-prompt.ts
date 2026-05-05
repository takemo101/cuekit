import type { TaskSpec } from "@cuekit/core";

const CHILD_REPORTING_CONTRACT = `Child reporting contract:
- Prefer the MCP tool report_task_event for progress and terminal reports.
- If MCP is unavailable, use the CLI fallback: cuekit tool report --type <progress|completed|failed|blocked|help_requested|log> --message "...".
- CUEKIT_TASK_ID and CUEKIT_CHILD_TOKEN are already provided in your environment; do not print or store the token.
- Report progress when useful, and report completed, failed, or blocked before you finish.
- As soon as your assigned objective is done or you have no further useful action, immediately send a terminal report (completed, failed, or blocked); do not sit idle at a prompt without reporting your state.
- If you are waiting on parent input or unsure how to proceed, report help_requested or blocked with the blocker and next action instead of staying silent.
- Use help_requested when parent input is needed and you can remain resumable.
- When useful, include simple observability payloads such as {"phase":"testing","files":{"read":["src/a.ts"],"written":["src/a.ts"]}}; report only the main files relevant to coordination/review.
- transcript markers and direct result.json writes are not the canonical reporting path; SQLite task_events written by report_task_event / cuekit tool report are canonical.
- Reporting does not automatically close your pane or process; finish normally after reporting.`;

function renderTeamContext(spec: TaskSpec): string | undefined {
	const team = spec.team_context;
	if (!team) return undefined;
	const header = `cuekit team ${team.team_id}: ${team.title}${team.objective ? ` — ${team.objective}` : ""}`;
	const preamble =
		"Team context:\nThis team context is supplemental; follow your agent profile and role instructions first if there is any conflict.";
	if (team.position === "coordinator") {
		return `${preamble}
You are the coordinator for ${header}.
Use cuekit tools when available. Recommended flow: inspect team status, submit workers for scoped tasks, wait with bounded polling (use follow_new_tasks when you expect to create more tasks), inspect results/events, request reviewer tasks, use steer_task or steer_team for stalled/off-scope work, then report a final team summary.
You are expected to run in the same coding-agent runtime as the caller/orchestrator, or another runtime with equivalent cuekit MCP/CLI access.
Cuekit will not schedule, route messages, or enforce coordinator authority for you; coordinate explicitly and do not micromanage workers unnecessarily. Do not cleanup tasks unless explicitly requested.`;
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
