import { join } from "node:path";

// Deterministic per-task artifact layout (per state-model.md §11.2):
//
//   <worktree>/.cuekit/tasks/<task_id>/
//     transcript.txt   — tmux pipe-pane capture of the child's session
//     result.json      — runtime-emitted normalized result, if any
//     exit-code        — `cuekit_exit=<n>` written by the wrapped
//                        launch command on child exit. Used by
//                        pane-adapter to distinguish completed (0)
//                        from failed (non-zero) when the pane dies.
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
	/** `<dir>/exit-code` — sentinel with `cuekit_exit=<n>`. */
	exitCodePath: string;
}

export function taskArtifactPaths(cwd: string, task_id: string): TaskArtifactPaths {
	const dir = join(cwd, ".cuekit", "tasks", task_id);
	return {
		dir,
		transcriptPath: join(dir, "transcript.txt"),
		resultPath: join(dir, "result.json"),
		exitCodePath: join(dir, "exit-code"),
	};
}

// Wraps a shell launch command so that its exit code is written to the
// per-task `exit-code` sentinel after the child exits. Uses a POSIX-sh
// subshell (`( ... ) ; printf '...' > …`), so it works under
// bash/zsh/dash/sh — the shell tmux picks to host the pane.
//
// The sentinel lets pane-adapter.status() tell the difference between a
// child that exited normally (cuekit_exit=0 → completed) and one that
// crashed (non-zero → failed). Without it, every pane-death was
// indistinguishable and got mapped to `failed`, which is why cuekit had
// no `completed` path in v0.
//
// Why a subshell and not a brace group: the `exit` builtin run inside
// `{ …; }` terminates the host shell before the trailing write can
// run, leaving no sentinel — an `exit N` inside the inner command
// would always look like SIGKILL to the outer layer. The `( … )`
// subshell absorbs the `exit`, so `$?` in the parent captures the
// real code and the sentinel is written. This was caught by the
// real-tmux dogfood test driving a deliberate `exit 42`.
export function wrapLaunchCommandWithExitCode(launchCommand: string, exitCodePath: string): string {
	// The sentinel path contains only `t_<hex>` task ids and workspace
	// paths. Quote anyway in case the worktree contains spaces.
	const quoted = `'${exitCodePath.replace(/'/g, `'\\''`)}'`;
	return `( ${launchCommand} ) ; printf 'cuekit_exit=%d\\n' "$?" > ${quoted} 2>/dev/null`;
}
