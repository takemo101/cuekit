import { describe, expect, it } from "bun:test";
import { parseAgentProfileMarkdown } from "../src/frontmatter.ts";

describe("parseAgentProfileMarkdown", () => {
	it("parses frontmatter and body", () => {
		const result = parseAgentProfileMarkdown({
			content: `---
id: reviewer
description: Review code
agent_kind: claude-code
model: sonnet
---

Review carefully.`,
			source: "builtin",
			filePath: "/profiles/reviewer.md",
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.profile.id).toBe("reviewer");
		expect(result.profile.instructions).toBe("Review carefully.");
		expect(result.profile.file_path).toBe("/profiles/reviewer.md");
	});

	it("parses files without frontmatter as body-only override input", () => {
		const result = parseAgentProfileMarkdown({
			content: "Just instructions.",
			source: "user",
		});
		expect(result.ok).toBe(false);
	});

	it("parses quoted scalar values", () => {
		const result = parseAgentProfileMarkdown({
			content: `---
id: 'docs-writer'
description: "Write docs"
---

Write docs.`,
			source: "project",
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.profile.id).toBe("docs-writer");
		expect(result.profile.description).toBe("Write docs");
	});

	it("parses tags as yaml list", () => {
		const result = parseAgentProfileMarkdown({
			content: `---
id: scout
description: Explore code
tags:
  - inspect
  - context
---

Scout.`,
			source: "builtin",
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.profile.tags).toEqual(["inspect", "context"]);
	});

	it("parses tags as comma-separated string", () => {
		const result = parseAgentProfileMarkdown({
			content: `---
id: debugger
description: Debug issues
tags: debug, test
---

Debug.`,
			source: "builtin",
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.profile.tags).toEqual(["debug", "test"]);
	});

	it("returns a structured error for unterminated frontmatter", () => {
		const result = parseAgentProfileMarkdown({
			content: `---
id: broken

Body`,
			source: "project",
		});
		expect(result).toEqual({ ok: false, error: "unterminated frontmatter" });
	});
});
