import { join } from "node:path";

// Deterministic per-task artifact layout (per state-model.md §11.2):
//
//   <worktree>/.cuekit/tasks/<task_id>/
//     transcript.txt   — tmux pipe-pane capture of the child's session
//     result.json      — runtime-emitted normalized result, if any
//
// This helper lives in `@cuekit/core` so every adapter (and any future
// tool that needs to locate a task's files) agrees on the path shape
// without replicating the join logic. The path strings are built with
// `node:path`, so they respect the caller's platform separators.
export interface TaskArtifactPaths {
	/** `<cwd>/.cuekit/tasks/<task_id>` — the per-task directory. */
	dir: string;
	/** `<dir>/transcript.txt` — tmux pipe-pane capture file. */
	transcriptPath: string;
	/** `<dir>/result.json` — runtime-emitted normalized result, if any. */
	resultPath: string;
}

export function taskArtifactPaths(cwd: string, task_id: string): TaskArtifactPaths {
	const dir = join(cwd, ".cuekit", "tasks", task_id);
	return {
		dir,
		transcriptPath: join(dir, "transcript.txt"),
		resultPath: join(dir, "result.json"),
	};
}
