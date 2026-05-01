import { describe, expect, it } from "bun:test";
import { renderTaskSpecPrompt } from "../src/task-spec-prompt.ts";

describe("renderTaskSpecPrompt", () => {
	it("injects role instructions before the child reporting contract", () => {
		const prompt = renderTaskSpecPrompt({
			agent_kind: "claude-code",
			objective: "do the thing",
			role: "reviewer",
			role_source: "project",
			role_instructions: "Review carefully.",
		});

		expect(prompt).toContain("Agent profile: reviewer (project)\nReview carefully.");
		expect(prompt.indexOf("Agent profile: reviewer")).toBeLessThan(
			prompt.indexOf("Child reporting contract:"),
		);
	});

	it("injects team context before the child reporting contract", () => {
		const prompt = renderTaskSpecPrompt({
			agent_kind: "claude-code",
			objective: "coordinate the team",
			team_context: {
				team_id: "tm_1",
				title: "Launch",
				position: "coordinator",
			},
		});

		expect(prompt).toContain("This team context is supplemental");
		expect(prompt).toContain("You are the coordinator for cuekit team tm_1: Launch.");
		expect(prompt).toContain("get_team_status");
		expect(prompt).toContain("submit follow-up team tasks");
		expect(prompt.indexOf("Team context:")).toBeLessThan(
			prompt.indexOf("Child reporting contract:"),
		);
	});

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
