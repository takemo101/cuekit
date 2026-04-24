import type { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	type AdapterCapabilities,
	ensureCollectable,
	isTerminalTaskStatus,
	type JobError,
	type SteeringMessage,
	type TaskListFilter,
	type TaskSpec,
	type TaskSummary,
	validateSpecAgainstCapabilities,
} from "@cuekit/core";
import {
	completeTask,
	createTask,
	getSessionById,
	getTaskById,
	listTasks,
	type Task,
	updateTaskNativeRef,
	updateTaskRefs,
	updateTaskStatus,
} from "@cuekit/store";
import { type AdapterSubmitInput, type AgentAdapter, generateTaskId } from "./agent-adapter.ts";
import type { PaneBackend } from "./pane-backend.ts";
import { normalizeTaskResult } from "./result-normalizer.ts";

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
}

export interface PaneAdapterDeps {
	db: Database;
	panes: PaneBackend;
}

export function createPaneAdapter(config: PaneAdapterConfig, deps: PaneAdapterDeps): AgentAdapter {
	const { db, panes } = deps;

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
		if (task.target_agent_kind !== config.kind) {
			return {
				ok: false,
				error: {
					code: "task_not_found",
					message: `task '${task_id}' is not managed by adapter '${config.kind}'`,
					retryable: false,
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
			return config.capabilities;
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
			const specCheck = validateSpecAgainstCapabilities(input.spec, config.capabilities);
			if (!specCheck.ok) {
				return { ok: false, error: specCheck.error };
			}
			// Guard against bogus session_id — createTask would throw a raw FK
			// error, which should be a structured invalid_input instead.
			const session = getSessionById(db, input.session_id);
			if (!session) {
				return {
					ok: false,
					error: {
						code: "invalid_input",
						message: `session '${input.session_id}' not found`,
						retryable: false,
					},
				};
			}

			const task_id = generateTaskId();
			createTask(db, {
				id: task_id,
				session_id: input.session_id,
				target_agent_kind: config.kind,
				model: input.spec.model,
				objective: input.spec.objective,
				status: "queued",
			});

			const launchCommand = config.buildLaunchCommand(input.spec);
			const cwd = input.spec.cwd ?? session.worktree_path;
			// Deterministic per-task output layout: <cwd>/.cuekit/tasks/<id>/
			// containing transcript.txt plus any runtime-emitted artifacts.
			// Dir creation is best-effort: read-only / missing cwd shouldn't
			// fail submit, it should just skip transcript capture. The runtime
			// still runs and the task can complete without a transcript.
			const desiredTranscriptPath = join(cwd, ".cuekit", "tasks", task_id, "transcript.txt");
			let transcriptPath: string | undefined;
			try {
				mkdirSync(dirname(desiredTranscriptPath), { recursive: true });
				transcriptPath = desiredTranscriptPath;
			} catch (err) {
				// Best-effort: unwritable cwd shouldn't block submit. Emit a
				// visible warning to stderr so the operator can see why the
				// transcript is missing, rather than silently returning empty
				// artifacts on collect.
				process.stderr.write(
					`cuekit: transcript capture disabled for task ${task_id} (${config.kind}): ${errorMessage(err)}\n`,
				);
			}

			try {
				const handle = await panes.spawnTask({
					task_id,
					launchCommand,
					cwd,
					transcriptPath,
				});
				updateTaskNativeRef(db, task_id, handle.pane_id);
				if (transcriptPath) {
					updateTaskRefs(db, task_id, { transcript_ref: transcriptPath });
				}
				updateTaskStatus(db, task_id, "running");
				return { ok: true as const, value: { task_id } };
			} catch (err) {
				updateTaskStatus(db, task_id, "failed");
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
				const now = new Date().toISOString();
				return {
					task_id,
					agent_kind: config.kind,
					status: "failed",
					created_at: now,
					updated_at: now,
					error: owned.error,
				};
			}
			let live = owned.task;
			if (!isTerminalTaskStatus(live.status)) {
				const alive = await panes.isAlive(task_id);
				if (!alive) {
					const updated = updateTaskStatus(db, task_id, "failed");
					if (updated) live = updated;
				}
			}
			const caps = config.capabilities;
			return {
				task_id,
				agent_kind: config.kind,
				status: live.status,
				summary: live.summary ?? undefined,
				created_at: live.created_at,
				updated_at: live.updated_at,
				completed_at: live.completed_at ?? undefined,
				native_task_id: live.native_task_ref ?? undefined,
				supports_steering: caps.supports_steering,
				supports_attach: caps.supports_attach,
				attach_hint: isTerminalTaskStatus(live.status)
					? undefined
					: caps.supports_attach
						? panes.computeAttachHint(task_id)
						: undefined,
			};
		},

		async steer(message: SteeringMessage) {
			const owned = ownTask(message.task_id);
			if (!owned.ok) return { ok: false, error: owned.error };

			if (!config.capabilities.supports_steering) {
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
						message: `tmux send-keys failed: ${errorMessage(err)}`,
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

			if (isTerminalTaskStatus(owned.task.status)) {
				return {
					ok: false,
					error: {
						code: "invalid_state",
						message: `task is already in terminal state '${owned.task.status}'`,
						retryable: false,
					},
				};
			}
			try {
				await panes.killTask(task_id);
			} catch (err) {
				return {
					ok: false,
					error: {
						code: "transport_error",
						message: `tmux kill-session failed: ${errorMessage(err)}`,
						retryable: true,
					},
				};
			}
			completeTask(db, {
				id: task_id,
				status: "cancelled",
				summary: owned.task.summary ?? "cancelled by caller",
			});
			if (config.onTerminal) {
				const finalRow = getTaskById(db, task_id);
				if (finalRow) config.onTerminal(finalRow, db);
			}
			return { ok: true, message: "cancellation requested" };
		},

		async list(filter?: TaskListFilter): Promise<TaskSummary[]> {
			// Adapters only return their own tasks, regardless of what kind the
			// caller asked for. Cross-adapter listing is the control surface's
			// job (list_tasks MCP tool queries the store directly).
			const effectiveFilter: TaskListFilter = {
				...filter,
				agent_kind: config.kind,
			};
			const tasks = listTasks(db, effectiveFilter);
			return tasks.map((t) => ({
				task_id: t.id,
				agent_kind: t.target_agent_kind,
				status: t.status,
				summary: t.summary ?? undefined,
				updated_at: t.updated_at,
			}));
		},
	};
}
