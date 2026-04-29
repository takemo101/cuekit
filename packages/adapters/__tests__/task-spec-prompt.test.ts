import { describe, expect, it } from "bun:test";
import { renderTaskSpecPrompt } from "../src/task-spec-prompt.ts";

describe("renderTaskSpecPrompt", () => {
	it("injects the child reporting contract", () => {
		const prompt = renderTaskSpecPrompt({ agent_kind: "claude-code", objective: "do the thing" });

		expect(prompt).toContain("report_task_event");
		expect(prompt).toContain("cuekit tool report");
		expect(prompt).toContain("CUEKIT_TASK_ID");
		expect(prompt).toContain("CUEKIT_CHILD_TOKEN");
		expect(prompt).toContain("transcript markers");
		expect(prompt).toContain("result.json");
		expect(prompt).toContain("help_requested when parent input is needed");
		expect(prompt).toContain("does not automatically close");
	});
});
