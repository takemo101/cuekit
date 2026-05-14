import { describe, expect, it } from "bun:test";
import { BUILTIN_AGENT_PROFILE_MARKDOWN } from "../src/builtins.ts";
import { parseAgentProfileMarkdown } from "../src/frontmatter.ts";

const expectedBuiltinIds = [
	"coordinator",
	"worker",
	"reviewer",
	"planner",
	"scout",
	"debugger",
	"docs-writer",
	"parent",
	"pr-finisher",
];

function instructionsFor(id: string): string {
	const markdown = BUILTIN_AGENT_PROFILE_MARKDOWN[id];
	if (!markdown) throw new Error(`missing builtin profile ${id}`);
	const parsed = parseAgentProfileMarkdown({ content: markdown, source: "builtin" });
	if (!parsed.ok) throw new Error(parsed.error);
	return parsed.profile.instructions;
}

describe("builtin agent profiles", () => {
	it("keeps the expected builtin profile catalog", () => {
		expect(Object.keys(BUILTIN_AGENT_PROFILE_MARKDOWN).sort()).toEqual(expectedBuiltinIds.sort());
	});

	it("provides substantive operating guidance for each builtin profile", () => {
		for (const id of expectedBuiltinIds) {
			const instructions = instructionsFor(id);
			expect(instructions).toContain("Mission:");
			expect(instructions).toContain("Operating rules:");
			expect(instructions).toContain("Output expectations:");
			expect(instructions).toContain("Do not override cuekit's final reporting contract");
			expect(instructions.split(/\s+/).filter(Boolean).length).toBeGreaterThanOrEqual(120);
		}
	});

	it("parent instructions describe long-lived handoff-aware coordination", () => {
		const markdown = BUILTIN_AGENT_PROFILE_MARKDOWN.parent;
		expect(markdown).toContain("id: parent");
		expect(markdown).toContain("long-lived");
		expect(markdown).toContain("agent_kind: claude-code");
		const instructions = instructionsFor("parent");
		expect(instructions).toContain("managed parent session task");
		expect(instructions).toContain("HANDOFF");
		expect(instructions).toContain("coordinators");
		expect(instructions).toContain("not as your replacement");
	});

	it("pr-finisher instructions mention required tool keywords", () => {
		const instructions = instructionsFor("pr-finisher");
		expect(instructions).toContain("but");
		expect(instructions).toContain("gh");
		expect(instructions).toContain("gh pr view");
		expect(instructions).toContain("blocked");
		expect(instructions).toContain("PR");
	});

	it("builtin profiles include Swarm-lite cooperative team guidance", () => {
		const coordinator = instructionsFor("coordinator");
		expect(coordinator).toContain("team snapshot");
		expect(coordinator).toContain("attention items");
		expect(coordinator).toContain("blackboard_events");
		expect(coordinator).toContain("Record important decisions");
		expect(coordinator).toContain("durable shared knowledge");
		expect(coordinator).toContain("manual and selective");

		const worker = instructionsFor("worker");
		expect(worker).toContain("important findings");
		expect(worker).toContain("blockers");
		expect(worker).toContain("changed assumptions");
		expect(worker).toContain("observability payloads");
		expect(worker).toContain("team blackboard");
		expect(worker).toContain("do not spawn or stop other agents");

		const reviewer = instructionsFor("reviewer");
		expect(reviewer).toContain("team snapshot");
		expect(reviewer).toContain("handoffs");
		expect(reviewer).toContain("relevant findings");
		expect(reviewer).toContain("severity");
		expect(reviewer).toContain("review_result");
		expect(reviewer).toContain("durable blackboard decisions/findings");

		const finisher = instructionsFor("pr-finisher");
		expect(finisher).toContain("worker and reviewer reports");
		expect(finisher).toContain("attention items");
		expect(finisher).toContain("handoffs");
		expect(finisher).toContain("final evidence");
		expect(finisher).toContain("cleanup decisions explicit");
	});

	it("Swarm-lite profile guidance does not imply autonomous workflow control", () => {
		for (const id of ["coordinator", "worker", "reviewer", "pr-finisher"]) {
			expect(instructionsFor(id)).not.toMatch(/auto-wake|auto-steer|scheduler/i);
		}
	});
});
