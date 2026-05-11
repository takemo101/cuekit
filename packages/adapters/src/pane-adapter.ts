import type { Database } from "bun:sqlite";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
	type AdapterCapabilities,
	canCancelTask,
	ensureCollectable,
	isTerminalTaskStatus,
	type JobError,
	type Logger,
	type SteeringMessage,
	silentLogger,
	type TaskListFilter,
	type TaskSpec,
	TaskSpecSchema,
	type TaskSummary,
	type TerminalTaskResultStatus,
	validateSpecAgainstCapabilities,
} from "@cuekit/core";
import {
	appendTaskEvent,
	completeTask,
	createTask,
	getSessionById,
	getTaskById,
	listTaskEvents,
	listTasks,
	type Task,
	updateTaskChildTokenHash,
	updateTaskNativeRef,
	updateTaskRefs,
	updateTaskStatus,
} from "@cuekit/store";
import {
	adapterRunModeFor,
	supportsAttachForMode,
	supportsSteeringForMode,
} from "./adapter-options.ts";
import { type AdapterSubmitInput, type AgentAdapter, generateTaskId } from "./agent-adapter.ts";
import type { MultiplexerBackend } from "./multiplexer-backend.ts";
import { normalizeTaskResult } from "./result-normalizer.ts";
import {
	globalTaskArtifactPaths,
	taskArtifactPaths,
	wrapLaunchCommandWithExitCode,
} from "./task-artifacts.ts";

// Decision returned by `onPaneDisappeared`. `status` must be terminal;
// `summary` is optional free-form text attached to the task row.
export interface PaneDisappearedDecision {
	status: TerminalTaskResultStatus;
	summary?: string;
}

// Context passed to `onPaneDisappeared`. The exit code comes from the
// sentinel file the wrapped launch command writes on child exit:
//   • `null` when no sentinel was found (pane killed via SIGKILL before
//     it could write, or the host shell died abnormally).
//   • `0` on clean child exit.
//   • Non-zero on runtime crash / non-zero exit.
export interface PaneDisappearedContext {
	task: Task;
	exitCode: number | null;
	transcriptPath?: string;
}

export interface PaneAdapterConfig {
	kind: string;
	capabilities: AdapterCapabilities;
	// Builds the shell command that runs inside the newly-spawned tmux pane.
	// Runtime-specific launch knowledge is concentrated here — everything else
	// in this factory is shared across adapters.
	buildLaunchCommand: (spec: TaskSpec) => string;
	// Optional callback invoked after terminal transition to let the adapter
	// populate summary / result_ref / transcript_ref from any runtime-native
	// output format before `collect` is called.
	onTerminal?: (task: Task, db: Database) => void;
	// Decides the terminal status when `status()` detects the pane has
	// died (and the task is not already terminal). The default inspects
	// the exit-code sentinel:
	//   • exit 0         → completed
	//   • non-zero exit  → failed
	//   • no sentinel    → failed ("pane exited without writing exit code")
	// Adapters with richer runtime output (e.g. a transcript-tail parser
	// that can detect a "task succeeded" marker when the process happens
	// to exit non-zero) can override.
	onPaneDisappeared?: (ctx: PaneDisappearedContext) => PaneDisappearedDecision;
}

export interface PaneAdapterDeps {
	db: Database;
	panes: MultiplexerBackend;
	// Optional sink for warnings (e.g. "transcript capture disabled"). Tests
	// default to the silent logger so submit failures on read-only cwds
	// don't pollute test output; the `cuekit` binary injects an stderr
	// logger so operators actually see warnings.
	logger?: Logger;
	// Cuekit's global directory (default `~/.cuekit/`). Used as the
	// fallback location for the exit-code sentinel when the worktree-local
	// `.cuekit/tasks/<id>/` is unwritable — without this fallback, every
	// clean exit on a read-only worktree would surface as `failed`. Tests
	// override with a tmpdir to avoid touching the operator's real home.
	cuekitHomeDir?: string;
}

// Reads the exit-code sentinel written by the wrapped launch command.
// Returns null if the file is missing or unparseable — either case is
// indistinguishable from "host shell died before writing" at this
// layer, which is exactly the signal `onPaneDisappeared` consumes.
function readExitCodeSentinel(exitCodePath: string): number | null {
	try {
		const raw = readFileSync(exitCodePath, "utf8");
		// Anchored at the start of a line. The wrap writes exactly one
		// `cuekit_exit=<n>\n`, but a hostile or buggy launch command
		// could include the substring elsewhere in stdout (which doesn't
		// reach this file in normal operation, but the anchor is cheap
		// defense in depth).
		const match = raw.match(/^cuekit_exit=(-?\d+)$/m);
		if (!match?.[1]) return null;
		const parsed = Number.parseInt(match[1], 10);
		return Number.isFinite(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function taskSpecFor(task: Task): TaskSpec | null {
	if (!task.spec_json) return null;
	try {
		return TaskSpecSchema.parse(JSON.parse(task.spec_json));
	} catch {
		return null;
	}
}

function timeoutMsFor(task: Task): number | null {
	const spec = taskSpecFor(task);
	return spec?.timeout_ms ?? null;
}

function hasTimedOut(task: Task, nowMs = Date.now()): { timedOut: true; timeoutMs: number } | null {
	const timeoutMs = timeoutMsFor(task);
	if (timeoutMs === null) return null;
	const anchor = Date.parse(task.started_at ?? task.created_at);
	if (!Number.isFinite(anchor)) return null;
	return nowMs - anchor >= timeoutMs ? { timedOut: true, timeoutMs } : null;
}

function nativeBackendKind(task: Task): string | null {
	const nativeRef = task.native_task_ref;
	if (!nativeRef) return null;
	const separator = nativeRef.indexOf(":");
	if (separator <= 0) return "tmux";
	return nativeRef.slice(0, separator);
}

function displayNativeTaskRef(nativeRef: string | null): string | undefined {
	if (!nativeRef) return undefined;
	const separator = nativeRef.indexOf(":");
	if (separator <= 0) return nativeRef;
	const backendKind = nativeRef.slice(0, separator);
	const displayRef = nativeRef.slice(separator + 1);
	if (backendKind === "herdr") {
		const parts = displayRef.split("/");
		return parts.length === 4 ? parts.slice(1).join("/") : displayRef;
	}
	return displayRef;
}

function sessionNameForBackend(
	kind: string,
	task_id: string,
	nativeRef?: string | null,
): string | null {
	if (kind === "tmux") return `cuekit-task-${task_id}`;
	if (kind === "zellij") {
		const displayRef = displayNativeTaskRef(nativeRef ?? null);
		const separator = displayRef?.indexOf("/") ?? -1;
		return separator > 0 ? (displayRef?.slice(0, separator) ?? null) : `ct-${task_id}`;
	}
	if (kind === "herdr") {
		const rawRef = nativeRef?.startsWith("herdr:") ? nativeRef.slice("herdr:".length) : undefined;
		const separator = rawRef?.indexOf("/") ?? -1;
		return separator > 0 ? (rawRef?.slice(0, separator) ?? null) : null;
	}
	return null;
}

function attachCommandForBackend(
	kind: string,
	task_id: string,
	nativeRef?: string | null,
): { argv: string[] } | null {
	const sessionName = sessionNameForBackend(kind, task_id, nativeRef);
	if (!sessionName) return null;
	if (kind === "tmux") return { argv: ["tmux", "attach-session", "-t", sessionName] };
	if (kind === "zellij") return { argv: ["zellij", "attach", sessionName] };
	if (kind === "herdr") return { argv: ["herdr", "--session", sessionName] };
	return null;
}

function paneHandleForTask(task: Task): {
	task_id: string;
	backend_kind: string;
	backend_session?: string;
	backend_pane_id?: string;
} | null {
	const backendKind = nativeBackendKind(task);
	if (!backendKind) return null;
	return {
		task_id: task.id,
		backend_kind: backendKind,
		...(task.team_id
			? {
					backend_label:
						backendKind === "herdr"
							? `team:${task.team_id}:${task.team_position ?? "member"}:${task.id}`
							: `${task.team_position ?? "team"}:${task.id}`,
				}
			: {}),
		...(sessionNameForBackend(backendKind, task.id, task.native_task_ref)
			? {
					backend_session: sessionNameForBackend(
						backendKind,
						task.id,
						task.native_task_ref,
					) as string,
				}
			: {}),
		...(displayNativeTaskRef(task.native_task_ref)
			? { backend_pane_id: displayNativeTaskRef(task.native_task_ref) as string }
			: {}),
	};
}

function backendMismatchError(
	task: Task,
	currentBackendKind: string,
	operation: string,
): JobError | null {
	const ownerBackendKind = nativeBackendKind(task);
	if (ownerBackendKind === null || ownerBackendKind === currentBackendKind) return null;
	return {
		code: "invalid_state",
		message: `cannot ${operation} task '${task.id}' through ${currentBackendKind}; it was created with ${ownerBackendKind}`,
		retryable: false,
		details: {
			task_id: task.id,
			operation,
			pane_backend_kind: ownerBackendKind,
			current_backend_kind: currentBackendKind,
		},
	};
}

function hasTimeoutDiagnosticEvent(task: Task, db: Database): boolean {
	return listTaskEvents(db, task.id).some(
		(event) =>
			event.type === "log" &&
			(event.payload as { diagnostic?: { kind?: string } } | null)?.diagnostic?.kind === "timeout",
	);
}

function shouldDeferMissingSentinel(task: Task, db: Database, nowMs = Date.now()): boolean {
	const latestEventMs = listTaskEvents(db, task.id).reduce((latest, event) => {
		const eventMs = Date.parse(event.created_at);
		return Number.isFinite(eventMs) ? Math.max(latest, eventMs) : latest;
	}, 0);
	return latestEventMs > 0 && nowMs - latestEventMs < 60_000;
}

function generateChildToken(): string {
	return randomBytes(32).toString("base64url");
}

function hashChildToken(rawToken: string): string {
	return `sha256:${createHash("sha256").update(rawToken).digest("hex")}`;
}

const defaultOnPaneDisappeared = (ctx: PaneDisappearedContext): PaneDisappearedDecision => {
	if (ctx.exitCode === 0) {
		return { status: "completed" };
	}
	if (ctx.exitCode !== null) {
		return {
			status: "failed",
			summary: `runtime exited with code ${ctx.exitCode}`,
		};
	}
	return {
		status: "failed",
		summary: "pane terminated without writing exit code",
	};
};

export function createPaneAdapter(config: PaneAdapterConfig, deps: PaneAdapterDeps): AgentAdapter {
	const { db, panes } = deps;
	const logger = deps.logger ?? silentLogger;
	const onPaneDisappeared = config.onPaneDisappeared ?? defaultOnPaneDisappeared;
	const cuekitHomeDir = deps.cuekitHomeDir ?? join(homedir(), ".cuekit");
	const defaultCapabilities: AdapterCapabilities = {
		...config.capabilities,
		default_mode: config.capabilities.default_mode ?? "interactive",
		supported_modes: config.capabilities.supported_modes ?? ["interactive"],
	};

	// Ensures a task exists AND is managed by this adapter. Prevents one adapter
	// from operating on another adapter's tasks even though they share the DB.
	function ownTask(task_id: string): { ok: true; task: Task } | { ok: false; error: JobError } {
		const task = getTaskById(db, task_id);
		if (!task) {
			return {
				ok: false,
				error: {
					code: "task_not_found",
					message: `task '${task_id}' not found`,
					retryable: false,
				},
			};
		}
		if (task.agent_kind !== config.kind) {
			// `permission_denied` (not `task_not_found`): the row exists,
			// the caller just routed it to the wrong adapter. Conflating
			// the two codes blinds operators to "task is real, you're
			// asking the wrong runtime" — that's a control-surface
			// routing bug, not a missing-resource error.
			return {
				ok: false,
				error: {
					code: "permission_denied",
					message: `task '${task_id}' is managed by adapter '${task.agent_kind}', not '${config.kind}'`,
					retryable: false,
					details: {
						task_id,
						owning_agent_kind: task.agent_kind,
						attempted_by: config.kind,
					},
				},
			};
		}
		return { ok: true, task };
	}

	function errorMessage(err: unknown): string {
		return err instanceof Error ? err.message : String(err);
	}

	return {
		kind: config.kind,

		capabilities(): AdapterCapabilities {
			return defaultCapabilities;
		},

		async submit(input: AdapterSubmitInput) {
			if (input.spec.agent_kind !== config.kind) {
				return {
					ok: false,
					error: {
						code: "invalid_input",
						message: `spec.agent_kind '${input.spec.agent_kind}' does not match adapter '${config.kind}'`,
						retryable: false,
					},
				};
			}
			// Hybrid model validation: if the adapter declared available_models or
			// supports_model_selection: false, fail fast before spawning anything.
			const specCheck = validateSpecAgainstCapabilities(input.spec, defaultCapabilities);
			if (!specCheck.ok) {
				return { ok: false, error: specCheck.error };
			}
			// Guard against bogus session_id — createTask would throw a raw
			// FK error otherwise. Use `session_not_found` (matches
			// delete_session and the spec §12.2 / protocol §12 enum) so
			// callers can distinguish a missing session from generic
			// invalid input. Earlier revisions returned `invalid_input`,
			// which conflicted with the spec sync landed in #40.
			const session = getSessionById(db, input.session_id);
			if (!session) {
				return {
					ok: false,
					error: {
						code: "session_not_found",
						message: `session '${input.session_id}' not found`,
						retryable: false,
					},
				};
			}

			const task_id = generateTaskId();
			const childToken = generateChildToken();
			createTask(db, {
				id: task_id,
				session_id: input.session_id,
				agent_kind: config.kind,
				model: input.spec.model,
				team_id: input.team_id,
				team_position: input.position,
				objective: input.spec.objective,
				status: "queued",
				spec: input.spec,
			});
			updateTaskChildTokenHash(db, task_id, hashChildToken(childToken));

			const rawLaunchCommand = config.buildLaunchCommand(input.spec);
			const cwd = input.spec.cwd ?? session.worktree_path;
			// Path layout for per-task artifacts is owned by core
			// (taskArtifactPaths) so every adapter + any future tool reads
			// the same convention from one place. Dir creation stays
			// best-effort: an unwritable cwd shouldn't block submit.
			const paths = taskArtifactPaths(cwd, task_id);
			let transcriptPath: string | undefined;
			let sentinelPath: string | undefined;
			try {
				mkdirSync(paths.dir, { recursive: true });
				transcriptPath = paths.transcriptPath;
				sentinelPath = paths.exitCodePath;
			} catch (err) {
				logger.warn("transcript capture disabled", {
					task_id,
					agent_kind: config.kind,
					reason: errorMessage(err),
				});
				// Worktree-local artifact dir failed (read-only mount,
				// ephemeral worktree, etc.). Fall back to the global
				// sentinel dir under cuekit's home so completed inference
				// still works for the pane-death path. Transcript stays
				// disabled because pipe-pane writes need the worktree
				// path verbatim — only the sentinel migrates.
				try {
					const globalPaths = globalTaskArtifactPaths(cuekitHomeDir, task_id);
					mkdirSync(globalPaths.dir, { recursive: true });
					sentinelPath = globalPaths.exitCodePath;
					logger.info("exit-code sentinel falling back to cuekit home", {
						task_id,
						agent_kind: config.kind,
						sentinel_path: sentinelPath,
					});
				} catch (fallbackErr) {
					logger.warn("exit-code sentinel disabled (worktree and home both unwritable)", {
						task_id,
						agent_kind: config.kind,
						reason: errorMessage(fallbackErr),
					});
				}
			}

			// Wrap the launch command so the child's exit code lands in
			// the chosen sentinel file (worktree-local or global fallback)
			// after the pane's shell exits. Without this, `status()`
			// couldn't tell a clean completion from a crash — that
			// ambiguity is what blocked the entire `completed` path in
			// v0. Run unwrapped only when both locations failed (the
			// default hook will then map pane-death → failed).
			const launchCommand = sentinelPath
				? wrapLaunchCommandWithExitCode(rawLaunchCommand, sentinelPath)
				: rawLaunchCommand;
			const mode = adapterRunModeFor(input.spec);

			try {
				const handle = await panes.spawnPane({
					task_id,
					team_id: input.team_id,
					team_position: input.position,
					command: launchCommand,
					cwd,
					transcriptPath,
					preserveNativeTty: supportsAttachForMode(mode),
					env: {
						CUEKIT_TASK_ID: task_id,
						CUEKIT_CHILD_TOKEN: childToken,
						CUEKIT_DB_PATH: db.filename,
					},
				});
				const nativeRef = handle.backend_pane_id
					? handle.backend_kind === "herdr" && handle.backend_session
						? `${handle.backend_kind}:${handle.backend_session}/${handle.backend_pane_id}`
						: `${handle.backend_kind}:${handle.backend_pane_id}`
					: undefined;
				if (nativeRef) {
					updateTaskNativeRef(db, task_id, nativeRef);
				}
				if (transcriptPath) {
					updateTaskRefs(db, task_id, { transcript_ref: transcriptPath });
				}
				updateTaskStatus(db, task_id, "running");
				return { ok: true as const, value: { task_id } };
			} catch (err) {
				updateTaskStatus(db, task_id, "failed");
				// Spawn failed before the child ever ran, so any
				// `.cuekit/tasks/<id>/` dir we created above is
				// guaranteed-empty (no transcript flushed, no sentinel
				// written). Remove it so a retry / next submit doesn't
				// trip over an orphan and operators don't have to
				// gc-by-hand. Best-effort: a chmod-flipped dir or a
				// permission race shouldn't bubble — we already have
				// the structured submit_failed below.
				if (transcriptPath) {
					try {
						rmSync(paths.dir, { recursive: true, force: true });
					} catch {
						// ignore — cleanup is best-effort
					}
				}
				return {
					ok: false as const,
					error: {
						code: "submit_failed",
						message: `adapter '${config.kind}' failed to spawn: ${errorMessage(err)}`,
						retryable: true,
						details: { task_id },
					},
				};
			}
		},

		async status(task_id) {
			const owned = ownTask(task_id);
			if (!owned.ok) {
				// Minimal error envelope per mcp-api-spec §6.5 — no fake
				// timestamps. Earlier revisions filled `created_at` and
				// `updated_at` with `1970-01-01` to satisfy the schema's
				// (then-mandatory) datetime fields; the schema is now
				// optional on those fields specifically so this path can
				// be honest about what we don't know. This is reachable
				// when a caller routes a task to the wrong adapter (the
				// cross-adapter `ownTask` rejection); the command layer
				// guards the not-found case before it ever gets here.
				return {
					task_id,
					agent_kind: config.kind,
					status: "failed",
					error: owned.error,
				};
			}
			let live = owned.task;
			let deferredDeadPane = false;
			let paneAliveForAttach: boolean | null = null;
			const ownerBackendKind = nativeBackendKind(live);
			const backendMismatch = ownerBackendKind !== null && ownerBackendKind !== panes.kind;
			const persistedHandle = paneHandleForTask(live);
			if (!backendMismatch && persistedHandle && panes.restorePaneHandle) {
				panes.restorePaneHandle(persistedHandle);
			}
			if (!isTerminalTaskStatus(live.status) && !backendMismatch) {
				const readTaskExitCode = () => {
					let exitCode: number | null = null;
					if (live.transcript_ref) {
						exitCode = readExitCodeSentinel(join(dirname(live.transcript_ref), "exit-code"));
					}
					if (exitCode === null) {
						exitCode = readExitCodeSentinel(
							globalTaskArtifactPaths(cuekitHomeDir, task_id).exitCodePath,
						);
					}
					return exitCode;
				};
				const markTerminalPane = async (completed: Task) => {
					if (panes.markPaneTerminal) {
						try {
							await panes.markPaneTerminal(completed.id, completed.status);
						} catch (err) {
							logger.warn("pane terminal rename failed", {
								task_id: completed.id,
								reason: errorMessage(err),
							});
						}
					}
				};
				const completeFromExitCode = async (exitCode: number) => {
					const decision = onPaneDisappeared({
						task: live,
						exitCode,
						transcriptPath: live.transcript_ref ?? undefined,
					});
					const completed = completeTask(db, {
						id: task_id,
						status: decision.status,
						summary: decision.summary ?? live.summary ?? undefined,
					});
					if (completed) {
						live = completed;
						await markTerminalPane(completed);
						if (config.onTerminal) config.onTerminal(completed, db);
					}
				};

				const alreadyExited = readTaskExitCode();
				if (alreadyExited !== null) {
					paneAliveForAttach = await panes.isAlive(task_id);
					await completeFromExitCode(alreadyExited);
				} else {
					const alive = await panes.isAlive(task_id);
					paneAliveForAttach = alive;
					if (!alive) {
						// Pane is gone but the row isn't terminal — infer the
						// terminal status from the exit-code sentinel (or the
						// adapter's override), then drive the same completeTask
						// path the explicit cancel flow uses so summary / timestamps
						// land consistently.
						// Exit-code sentinel lookup. Worktree-local first
						// (the happy path — same dir as the transcript per
						// `taskArtifactPaths`), then the global fallback
						// under cuekit's home (see submit's mkdir cascade).
						// The fallback is what makes completed inference work
						// on read-only worktrees: without transcript_ref the
						// only place a sentinel could exist is the global
						// dir.
						let exitCode: number | null = readTaskExitCode();
						if (exitCode === null) {
							for (let attempt = 0; attempt < 10 && exitCode === null; attempt += 1) {
								await Bun.sleep(250);
								exitCode = readTaskExitCode();
							}
						}
						if (exitCode === null && shouldDeferMissingSentinel(live, db)) {
							deferredDeadPane = true;
						}
						if (!deferredDeadPane) {
							const decision = onPaneDisappeared({
								task: live,
								exitCode,
								transcriptPath: live.transcript_ref ?? undefined,
							});
							const completed = completeTask(db, {
								id: task_id,
								status: decision.status,
								summary: decision.summary ?? live.summary ?? undefined,
							});
							if (completed) {
								live = completed;
								await markTerminalPane(completed);
								if (config.onTerminal) config.onTerminal(completed, db);
							}
						}
					} else {
						const timeout = hasTimedOut(live);
						if (timeout) {
							const timeoutMessage = `timed out after ${timeout.timeoutMs}ms`;
							await panes.killPane(task_id);
							paneAliveForAttach = false;
							const completed = completeTask(db, {
								id: task_id,
								status: "timed_out",
								summary: timeoutMessage,
							});
							if (completed && !hasTimeoutDiagnosticEvent(completed, db)) {
								appendTaskEvent(db, {
									id: `e_${randomUUID()}`,
									task_id,
									type: "log",
									message: `task ${timeoutMessage}`,
									payload: { diagnostic: { kind: "timeout", message: timeoutMessage } },
								});
							}
							if (completed) {
								live = completed;
								await markTerminalPane(completed);
								if (config.onTerminal) config.onTerminal(completed, db);
							}
						}
					}
				}
			}
			if (
				isTerminalTaskStatus(live.status) &&
				!backendMismatch &&
				panes.kind === "herdr" &&
				paneAliveForAttach === null
			) {
				paneAliveForAttach = await panes.isAlive(task_id);
			}
			const caps = defaultCapabilities;
			const mode = adapterRunModeFor(
				taskSpecFor(live) ?? { agent_kind: config.kind, objective: live.objective },
			);
			const storedAttachCommand = ownerBackendKind
				? attachCommandForBackend(ownerBackendKind, task_id, live.native_task_ref)
				: null;
			const attachCommand = backendMismatch
				? storedAttachCommand
				: (panes.attachCommand(task_id) ?? null);
			const paneSessionName = backendMismatch
				? (sessionNameForBackend(ownerBackendKind, task_id, live.native_task_ref) ??
					panes.sessionNameFor(task_id))
				: panes.sessionNameFor(task_id);
			const supportsSteering =
				!backendMismatch &&
				!deferredDeadPane &&
				caps.supports_steering &&
				supportsSteeringForMode(mode);
			const terminal = isTerminalTaskStatus(live.status);
			const supportsAttach =
				!deferredDeadPane &&
				caps.supports_attach &&
				supportsAttachForMode(mode) &&
				attachCommand !== null &&
				(terminal ? paneAliveForAttach === true : backendMismatch || paneAliveForAttach !== false);
			return {
				task_id,
				agent_kind: config.kind,
				...(live.team_id ? { team_id: live.team_id } : {}),
				...(live.team_position ? { position: live.team_position } : {}),
				status: live.status,
				summary: live.summary ?? undefined,
				created_at: live.created_at,
				updated_at: live.updated_at,
				started_at: live.started_at ?? undefined,
				completed_at: live.completed_at ?? undefined,
				native_task_id: displayNativeTaskRef(live.native_task_ref),
				supports_steering: supportsSteering,
				supports_attach: supportsAttach,
				attach_hint: supportsAttach ? attachCommand.argv.join(" ") : undefined,
				attach_command: supportsAttach ? attachCommand : null,
				metadata: {
					adapter_mode: mode,
					// `tmux_session_name` is the legacy field — kept during the
					// deprecation window. New consumers should read
					// `pane_session_name` instead. Both are populated from the
					// same source. Removal is filed as P5.2 (#423).
					tmux_session_name: paneSessionName,
					pane_session_name: paneSessionName,
					...(live.native_task_ref
						? { tmux_pane_id: displayNativeTaskRef(live.native_task_ref) }
						: {}),
					...(ownerBackendKind ? { pane_backend_kind: ownerBackendKind } : {}),
					...(backendMismatch ? { pane_backend_mismatch: true } : {}),
				},
			};
		},

		async steer(message: SteeringMessage) {
			const owned = ownTask(message.task_id);
			if (!owned.ok) return { ok: false, error: owned.error };

			const backendMismatch = backendMismatchError(owned.task, panes.kind, "steer");
			if (backendMismatch) return { ok: false, error: backendMismatch };
			const persistedHandle = paneHandleForTask(owned.task);
			if (persistedHandle && panes.restorePaneHandle) panes.restorePaneHandle(persistedHandle);

			const mode = adapterRunModeFor(
				taskSpecFor(owned.task) ?? { agent_kind: config.kind, objective: owned.task.objective },
			);
			if (!defaultCapabilities.supports_steering || !supportsSteeringForMode(mode)) {
				return {
					ok: false,
					error: {
						code: "steering_unsupported",
						message: `adapter '${config.kind}' does not support steering`,
						retryable: false,
					},
				};
			}
			if (isTerminalTaskStatus(owned.task.status)) {
				return {
					ok: false,
					error: {
						code: "invalid_state",
						message: `cannot steer terminal task (status '${owned.task.status}')`,
						retryable: false,
					},
				};
			}
			if (!(await panes.isAlive(message.task_id))) {
				return {
					ok: false,
					error: {
						code: "invalid_state",
						message: "task pane is no longer alive",
						retryable: false,
					},
				};
			}
			try {
				await panes.sendKeys(message.task_id, message.message);
				return { ok: true, message: "steering message delivered" };
			} catch (err) {
				return {
					ok: false,
					error: {
						code: "transport_error",
						message: `pane backend send-keys failed: ${errorMessage(err)}`,
						retryable: true,
					},
				};
			}
		},

		async collect(task_id) {
			const owned = ownTask(task_id);
			if (!owned.ok) return { ok: false, error: owned.error };

			const check = ensureCollectable(owned.task.status);
			if (!check.ok) {
				return { ok: false, error: check.error };
			}
			return { ok: true, value: normalizeTaskResult(owned.task) };
		},

		async cancel(task_id) {
			const owned = ownTask(task_id);
			if (!owned.ok) return { ok: false, error: owned.error };

			const cancelCheck = canCancelTask(owned.task.status);
			if (!cancelCheck.ok) return { ok: false, error: cancelCheck.error };
			const backendMismatch = backendMismatchError(owned.task, panes.kind, "cancel");
			if (backendMismatch) return { ok: false, error: backendMismatch };
			const persistedHandle = paneHandleForTask(owned.task);
			if (persistedHandle && panes.restorePaneHandle) panes.restorePaneHandle(persistedHandle);
			try {
				await panes.killPane(task_id);
			} catch (err) {
				return {
					ok: false,
					error: {
						code: "transport_error",
						message: `pane backend kill failed: ${errorMessage(err)}`,
						retryable: true,
					},
				};
			}
			const completed = completeTask(db, {
				id: task_id,
				status: "cancelled",
				summary: owned.task.summary ?? "cancelled by caller",
			});
			if (completed && panes.markPaneTerminal) {
				try {
					await panes.markPaneTerminal(completed.id, completed.status);
				} catch (err) {
					logger.warn("pane terminal rename failed", {
						task_id: completed.id,
						reason: errorMessage(err),
					});
				}
			}
			if (config.onTerminal) {
				const finalRow = getTaskById(db, task_id);
				if (finalRow) config.onTerminal(finalRow, db);
			}
			return { ok: true, message: "cancellation requested" };
		},

		async cleanup(task_id: string) {
			const task = getTaskById(db, task_id);
			if (!task) return;
			const backendMismatch = backendMismatchError(task, panes.kind, "cleanup");
			if (backendMismatch) {
				logger.warn("refusing cleanup for task owned by a different pane backend", {
					task_id,
					pane_backend_kind: backendMismatch.details?.pane_backend_kind,
					current_backend_kind: panes.kind,
				});
				throw new Error(backendMismatch.message);
			}
			const persistedHandle = paneHandleForTask(task);
			if (persistedHandle && panes.restorePaneHandle) panes.restorePaneHandle(persistedHandle);
			await panes.killPane(task_id);
		},

		async list(filter?: TaskListFilter): Promise<TaskSummary[]> {
			// Adapters only return their own tasks. If the caller passed a
			// conflicting `agent_kind` explicitly, fail loud rather than
			// silently rewriting it — the silent-override variant was
			// caught by Oracle review (PR #19) returning wrong-looking
			// results from correct-looking inputs. Cross-adapter listing
			// belongs to the control surface's `list_tasks` MCP tool,
			// which queries the store directly.
			if (filter?.agent_kind !== undefined && filter.agent_kind !== config.kind) {
				throw new Error(
					`adapter '${config.kind}' cannot list tasks for agent_kind '${filter.agent_kind}'; use the control-surface list_tasks tool for cross-adapter queries`,
				);
			}
			const effectiveFilter: TaskListFilter = {
				...filter,
				agent_kind: config.kind,
			};
			const tasks = listTasks(db, effectiveFilter);
			return tasks.map((t) => ({
				task_id: t.id,
				agent_kind: t.agent_kind,
				...(t.team_id ? { team_id: t.team_id } : {}),
				...(t.team_position ? { position: t.team_position } : {}),
				status: t.status,
				summary: t.summary ?? undefined,
				updated_at: t.updated_at,
			}));
		},
	};
}
