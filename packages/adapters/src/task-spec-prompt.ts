import type { TaskSpec } from "@cuekit/core";

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

	return sections.join("\n\n");
}
