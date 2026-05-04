import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { taskArtifactPaths } from "../src/task-artifacts.ts";

describe("taskArtifactPaths", () => {
	it("builds the canonical per-task layout under <cwd>/.cuekit/tasks/<id>/", () => {
		const paths = taskArtifactPaths("/repo", "t_abc");
		expect(paths.dir).toBe("/repo/.cuekit/tasks/t_abc");
		expect(paths.transcriptPath).toBe("/repo/.cuekit/tasks/t_abc/transcript.txt");
		expect(paths.resultPath).toBe("/repo/.cuekit/tasks/t_abc/result.json");
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

	it("transcriptPath and resultPath live inside dir", () => {
		const paths = taskArtifactPaths("/repo", "t_abc");
		expect(paths.transcriptPath.startsWith(paths.dir)).toBe(true);
		expect(paths.resultPath.startsWith(paths.dir)).toBe(true);
	});
});
