import { describe, expect, it } from "bun:test";
import { parseAgentProfileMarkdown } from "../src/frontmatter.ts";
import { mergeAgentProfiles } from "../src/merge.ts";
import type { AgentProfileFile, AgentProfileSource } from "../src/schema.ts";

function profile(markdown: string, source: AgentProfileSource, filePath: string): AgentProfileFile {
	const parsed = parseAgentProfileMarkdown({ content: markdown, source, filePath });
	if (!parsed.ok) throw new Error(parsed.error);
	return parsed.profile;
}

describe("mergeAgentProfiles", () => {
	const builtin = profile(
		`---
id: reviewer
description: Review code
agent_kind: claude-code
model: sonnet
tags: review, code-quality
---

Review carefully.`,
		"builtin",
		"builtin/reviewer.md",
	);

	it("resolves builtin-only profiles", () => {
		const result = mergeAgentProfiles([builtin]);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.profiles[0]).toMatchObject({
			id: "reviewer",
			description: "Review code",
			agent_kind: "claude-code",
			model: "sonnet",
			source: "builtin",
			sources: ["builtin"],
		});
	});

	it("lets user override builtin model", () => {
		const user = profile("---\nid: reviewer\nmodel: opus\n---", "user", "user/reviewer.md");
		const result = mergeAgentProfiles([builtin, user]);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.profiles[0]?.model).toBe("opus");
		expect(result.profiles[0]?.description).toBe("Review code");
	});

	it("lets project override user and builtin", () => {
		const user = profile("---\nid: reviewer\nmodel: opus\n---", "user", "user/reviewer.md");
		const project = profile(
			"---\nid: reviewer\nmodel: haiku\n---",
			"project",
			"project/reviewer.md",
		);
		const result = mergeAgentProfiles([project, builtin, user]);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.profiles[0]?.model).toBe("haiku");
		expect(result.profiles[0]?.source).toBe("project");
	});

	it("replaces instructions by default", () => {
		const user = profile("---\nid: reviewer\n---\n\nUse local rules.", "user", "user/reviewer.md");
		const result = mergeAgentProfiles([builtin, user]);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.profiles[0]?.instructions).toBe("Use local rules.");
	});

	it("appends instructions when requested", () => {
		const user = profile(
			"---\nid: reviewer\ninstructions_mode: append\n---\n\nAlso check tests.",
			"user",
			"user/reviewer.md",
		);
		const result = mergeAgentProfiles([builtin, user]);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.profiles[0]?.instructions).toContain("Review carefully.");
		expect(result.profiles[0]?.instructions).toContain("Also check tests.");
	});

	it("rejects duplicate ids inside a scope", () => {
		const duplicate = profile(
			"---\nid: reviewer\ndescription: Other\n---\n\nOther.",
			"builtin",
			"builtin/other.md",
		);
		const result = mergeAgentProfiles([builtin, duplicate]);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain("duplicate agent profile id 'reviewer'");
	});
});
