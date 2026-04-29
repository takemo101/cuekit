import { describe, expect, it } from "bun:test";
import type { TaskSpec } from "@cuekit/core";
import { buildClaudeCodeLaunchCommand } from "../src/claude-code-adapter.ts";

// Structural tests for the argv the adapter hands to `tmux new-session`.
// Doesn't spawn tmux or claude — pins the exact shell command shape so we
// can see breakage at the argv layer without running anything external.

function spec(overrides: Partial<TaskSpec> = {}): TaskSpec {
	return {
		agent_kind: "claude-code",
		objective: "do the thing",
		...overrides,
	};
}

describe("buildClaudeCodeLaunchCommand", () => {
	it("defaults to the 'claude' binary", () => {
		expect(buildClaudeCodeLaunchCommand(spec())).toStartWith("claude 'do the thing");
	});

	it("respects a custom claudeBin", () => {
		expect(
			buildClaudeCodeLaunchCommand(spec(), { claudeBin: "/usr/local/bin/claude" }),
		).toStartWith("/usr/local/bin/claude 'do the thing");
	});

	it("inserts --model before the objective when a model is requested", () => {
		expect(buildClaudeCodeLaunchCommand(spec({ model: "sonnet" }))).toStartWith(
			"claude --model 'sonnet' 'do the thing",
		);
	});

	it("shell-quotes model names with shell metacharacters", () => {
		const out = buildClaudeCodeLaunchCommand(spec({ model: "sonnet; touch /tmp/pwned" }));
		expect(out).toContain("--model 'sonnet; touch /tmp/pwned'");
	});

	it("does NOT pass --print / -p (interactive mode preserves attach)", () => {
		// Token-level check instead of substring — a trailing '-p' (no space)
		// or a '-p' at end of line would slip past a naive toContain.
		const tokens = buildClaudeCodeLaunchCommand(spec({ model: "opus" })).split(/\s+/);
		expect(tokens).not.toContain("--print");
		expect(tokens).not.toContain("-p");
	});

	it("shell-quotes objectives with single quotes via POSIX '\\'' escape", () => {
		const out = buildClaudeCodeLaunchCommand(spec({ objective: "it's a test" }));
		// Shell-reconstituted reads back to: it's a test
		expect(out).toStartWith("claude 'it'\\''s a test");
	});

	it("shell-quotes objectives with shell metacharacters", () => {
		const out = buildClaudeCodeLaunchCommand(spec({ objective: "rm -rf $HOME; echo pwned" }));
		// Metacharacters are literal inside single quotes — no interpolation
		expect(out).toStartWith("claude 'rm -rf $HOME; echo pwned");
	});

	it("preserves multi-line objectives as-is inside single quotes", () => {
		const out = buildClaudeCodeLaunchCommand(spec({ objective: "line one\nline two" }));
		expect(out).toStartWith("claude 'line one\nline two");
	});
});
