import { describe, expect, it } from "bun:test";
import { BUILTIN_AGENT_PROFILE_MARKDOWN } from "../src/builtins.ts";
import { parseAgentProfileMarkdown } from "../src/frontmatter.ts";

const expectedBuiltinIds = [
	"worker",
	"reviewer",
	"planner",
	"scout",
	"debugger",
	"docs-writer",
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

	it("pr-finisher instructions mention required tool keywords", () => {
		const instructions = instructionsFor("pr-finisher");
		expect(instructions).toContain("but");
		expect(instructions).toContain("gh");
		expect(instructions).toContain("gh pr view");
		expect(instructions).toContain("blocked");
		expect(instructions).toContain("PR");
	});
});
