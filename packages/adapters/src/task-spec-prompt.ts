import type { TaskSpec } from "@cuekit/core";

const CHILD_REPORTING_CONTRACT = `Child reporting contract:
- Prefer the MCP tool report_task_event for progress and terminal reports.
- If MCP is unavailable, use the CLI fallback: cuekit tool report --type <progress|completed|failed|blocked|help_requested|log> --message "...".
- CUEKIT_TASK_ID and CUEKIT_CHILD_TOKEN are already provided in your environment; do not print or store the token.
- Report progress when useful, and report completed, failed, or blocked before you finish.
- Use help_requested when parent input is needed and you can remain resumable.
- transcript markers and direct result.json writes are not the canonical reporting path; SQLite task_events written by report_task_event / cuekit tool report are canonical.
- Reporting does not automatically close your pane or process; finish normally after reporting.`;

export function renderTaskSpecPrompt(spec: TaskSpec): string {
	const sections: string[] = [spec.objective];

	if (spec.context) {
		sections.push(`Context:\n${spec.context}`);
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
