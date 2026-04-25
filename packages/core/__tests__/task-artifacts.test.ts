import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { taskArtifactPaths, wrapLaunchCommandWithExitCode } from "../src/task-artifacts.ts";

describe("taskArtifactPaths", () => {
	it("builds the canonical per-task layout under <cwd>/.cuekit/tasks/<id>/", () => {
		const paths = taskArtifactPaths("/repo", "t_abc");
		expect(paths.dir).toBe("/repo/.cuekit/tasks/t_abc");
		expect(paths.transcriptPath).toBe("/repo/.cuekit/tasks/t_abc/transcript.txt");
		expect(paths.resultPath).toBe("/repo/.cuekit/tasks/t_abc/result.json");
		expect(paths.exitCodePath).toBe("/repo/.cuekit/tasks/t_abc/exit-code");
	});

	it("normalizes a trailing slash on cwd via node:path", () => {
		const paths = taskArtifactPaths("/repo/", "t_abc");
		expect(paths.dir).toBe("/repo/.cuekit/tasks/t_abc");
	});

	it("preserves relative cwd", () => {
		const paths = taskArtifactPaths(".", "t_abc");
		expect(paths.dir).toBe(join(".", ".cuekit", "tasks", "t_abc"));
	});

	it("keeps the task_id verbatim (even with prefixes like 't_')", () => {
		const paths = taskArtifactPaths("/repo", "t_abc123def456");
		expect(paths.dir).toBe("/repo/.cuekit/tasks/t_abc123def456");
	});

	it("transcriptPath, resultPath, and exitCodePath all live inside dir", () => {
		const paths = taskArtifactPaths("/repo", "t_abc");
		expect(paths.transcriptPath.startsWith(paths.dir)).toBe(true);
		expect(paths.resultPath.startsWith(paths.dir)).toBe(true);
		expect(paths.exitCodePath.startsWith(paths.dir)).toBe(true);
	});
});

describe("wrapLaunchCommandWithExitCode", () => {
	// These tests verify the structural shape of the wrapper string.
	// PR #41 caught a real shell-semantics bug (`{ exit 42 ; }` exits the
	// host shell before the trailer fires) that survived FakeTmuxRunner
	// tests because the fake doesn't run shell. Asserting the shape here
	// is the cheap regression net — anyone re-introducing a brace group,
	// dropping the sentinel, or changing the format flips a unit test
	// instead of waiting for dogfood to catch it.

	const SENTINEL = "/repo/.cuekit/tasks/t_abc/exit-code";

	it("uses a subshell, not a brace group, around the inner command", () => {
		// Brace groups don't isolate `exit N`; subshells do. The literal
		// `( ... ) ;` shape is what makes inner `exit` propagate via $?
		// instead of taking down the host shell before the trailer fires.
		const wrapped = wrapLaunchCommandWithExitCode("claude --task t1", SENTINEL);
		expect(wrapped).toContain("( claude --task t1 ) ;");
		expect(wrapped).not.toMatch(/\{\s*claude/);
	});

	it("captures `$?` after the inner command, not before", () => {
		const wrapped = wrapLaunchCommandWithExitCode("anything", SENTINEL);
		// The `$?` reference must come after the trailing `;` so it
		// captures the subshell's exit, not whatever was set before.
		const dollarIdx = wrapped.indexOf('"$?"');
		const semiIdx = wrapped.lastIndexOf(") ;");
		expect(dollarIdx).toBeGreaterThan(semiIdx);
	});

	it("writes a newline-terminated `cuekit_exit=<n>` line — matches the parser", () => {
		const wrapped = wrapLaunchCommandWithExitCode("anything", SENTINEL);
		expect(wrapped).toContain("printf 'cuekit_exit=%d\\n'");
	});

	it("redirects stderr of the trailer so a write failure doesn't pollute the transcript", () => {
		const wrapped = wrapLaunchCommandWithExitCode("anything", SENTINEL);
		expect(wrapped).toContain("2>/dev/null");
	});

	it("single-quotes the sentinel path so worktrees with spaces survive", () => {
		const path = "/Users/me/My Code/.cuekit/tasks/t_abc/exit-code";
		const wrapped = wrapLaunchCommandWithExitCode("anything", path);
		expect(wrapped).toContain(`'${path}'`);
	});

	it("escapes single quotes in the sentinel path (rare but legal)", () => {
		const path = "/tmp/it's-fine/exit-code";
		const wrapped = wrapLaunchCommandWithExitCode("anything", path);
		// Standard POSIX-sh single-quote escape: 'it'\''s-fine'
		expect(wrapped).toContain(`'/tmp/it'\\''s-fine/exit-code'`);
	});

	it("preserves the original launch command verbatim inside the subshell", () => {
		// The wrap must not rewrite the inner command — adapters compose
		// it with their own quoting rules already. The string survives
		// unchanged, embedded between the parens.
		const cmd = `claude --objective $'multi\\nline' && echo 'done'`;
		const wrapped = wrapLaunchCommandWithExitCode(cmd, SENTINEL);
		expect(wrapped).toContain(`( ${cmd} )`);
	});
});
