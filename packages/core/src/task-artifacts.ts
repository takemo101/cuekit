import { join } from "node:path";

// Deterministic per-task output layout (per state-model.md §11.2):
//
//   <worktree>/.cuekit/tasks/<task_id>/
//     transcript.txt   — captured child output
//     result.json      — normalized result, if any
//
// This helper lives in `@cuekit/core` so protocol consumers agree on the
// stable local output-ref layout without replicating the path shape.
export interface TaskArtifactPaths {
	/** `<cwd>/.cuekit/tasks/<task_id>` — the per-task directory. */
	dir: string;
	/** `<dir>/transcript.txt` — captured child output file. */
	transcriptPath: string;
	/** `<dir>/result.json` — normalized result, if any. */
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
