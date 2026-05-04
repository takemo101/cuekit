import { join } from "node:path";
import {
	type TaskArtifactPaths as CoreTaskArtifactPaths,
	taskArtifactPaths as coreTaskArtifactPaths,
} from "@cuekit/core";

export interface TaskArtifactPaths extends CoreTaskArtifactPaths {
	/** `<dir>/exit-code` — adapter sentinel with `cuekit_exit=<n>`. */
	exitCodePath: string;
}

export function taskArtifactPaths(cwd: string, task_id: string): TaskArtifactPaths {
	const paths = coreTaskArtifactPaths(cwd, task_id);
	return {
		...paths,
		exitCodePath: join(paths.dir, "exit-code"),
	};
}

// Global fallback for the exit-code sentinel when the worktree-local
// `.cuekit/tasks/<id>/` is unwritable (read-only mount, ephemeral
// worktree, deno-style permission gates). This is adapter runtime plumbing,
// not part of the core protocol artifact contract.
export interface GlobalTaskArtifactPaths {
	dir: string;
	exitCodePath: string;
}

export function globalTaskArtifactPaths(
	cuekitHome: string,
	task_id: string,
): GlobalTaskArtifactPaths {
	const dir = join(cuekitHome, "sentinels", task_id);
	return {
		dir,
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
	const errQuoted = `'${`${exitCodePath}.err`.replace(/'/g, `'\\''`)}'`;
	// Redirect stderr from the sentinel write to a sibling `.err` file
	// rather than `/dev/null`, so a write failure (disk full, permission
	// flip mid-run, etc.) leaves a diagnosable trace next to the
	// sentinel — earlier the trailer's stderr was discarded outright,
	// hiding real ops issues. status() ignores `.err`; operators see it
	// when they list the task dir. Non-existent `.err` is the happy path.
	return `( ${launchCommand} ) ; printf 'cuekit_exit=%d\\n' "$?" > ${quoted} 2>${errQuoted}`;
}
