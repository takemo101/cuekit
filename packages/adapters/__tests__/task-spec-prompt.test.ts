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
		expect(prompt).toContain("submit workers");
		expect(prompt).toContain("wait with bounded polling");
		expect(prompt).toContain("request reviewer tasks");
		expect(prompt).toContain("steer_task or steer_team");
		expect(prompt).toContain("When team status or result includes attention_items");
		expect(prompt).toContain("inspect them before deciding whether to continue");
		expect(prompt).toContain("report a final team summary");
		expect(prompt).not.toContain("automatically schedules");
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
		expect(prompt).toContain("do not sit idle at a prompt without reporting your state");
		expect(prompt).toContain("report help_requested or blocked with the blocker and next action");
		expect(prompt).toContain("observability payloads");
		expect(prompt).toContain(
			'{"phase":"testing","files":{"read":["src/a.ts"],"written":["src/a.ts"]}}',
		);
		expect(prompt).toContain("does not automatically close");
	});
});
