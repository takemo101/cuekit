import type { Database } from "bun:sqlite";
import {
	type AdapterCapabilities,
	ensureCollectable,
	isTerminalTaskStatus,
	type SteeringMessage,
	type TaskSpec,
	type TaskSummary,
} from "@cuekit/core";
import {
	completeTask,
	createTask,
	getTaskById,
	type Task,
	updateTaskNativeRef,
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

	function syncLiveness(task: Task): Task {
		// If the pane is gone but the row still says non-terminal, mark failed.
		// The synchronous status call doesn't await, so this is best-effort for
		// crash detection during status reads.
		if (isTerminalTaskStatus(task.status)) return task;
		// Liveness check is async; callers do it themselves in status().
		return task;
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
			const cwd = input.spec.cwd ?? process.cwd();

			try {
				const handle = await panes.spawnTask({ task_id, launchCommand, cwd });
				updateTaskNativeRef(db, task_id, handle.pane_id);
				updateTaskStatus(db, task_id, "running");
				return { ok: true as const, value: { task_id } };
			} catch (err) {
				updateTaskStatus(db, task_id, "failed");
				return {
					ok: false as const,
					error: {
						code: "submit_failed",
						message: `adapter '${config.kind}' failed to spawn: ${(err as Error).message}`,
						retryable: true,
						details: { task_id },
					},
				};
			}
		},

		async status(task_id) {
			const task = getTaskById(db, task_id);
			if (!task) {
				const now = new Date().toISOString();
				return {
					task_id,
					agent_kind: config.kind,
					status: "failed",
					created_at: now,
					updated_at: now,
					error: {
						code: "task_not_found",
						message: `task '${task_id}' is not tracked by adapter '${config.kind}'`,
						retryable: false,
					},
				};
			}
			let live = task;
			if (!isTerminalTaskStatus(task.status)) {
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
			const task = getTaskById(db, message.task_id);
			if (!task) {
				return {
					ok: false,
					error: {
						code: "task_not_found",
						message: `task '${message.task_id}' not found`,
						retryable: false,
					},
				};
			}
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
			if (isTerminalTaskStatus(task.status)) {
				return {
					ok: false,
					error: {
						code: "invalid_state",
						message: `cannot steer terminal task (status '${task.status}')`,
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
			await panes.sendKeys(message.task_id, message.message);
			return { ok: true, message: "steering message delivered" };
		},

		async collect(task_id) {
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
			const check = ensureCollectable(task.status);
			if (!check.ok) {
				return { ok: false, error: check.error };
			}
			return { ok: true, value: normalizeTaskResult(task) };
		},

		async cancel(task_id) {
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
			if (isTerminalTaskStatus(task.status)) {
				return {
					ok: false,
					error: {
						code: "invalid_state",
						message: `task is already in terminal state '${task.status}'`,
						retryable: false,
					},
				};
			}
			await panes.killTask(task_id);
			completeTask(db, {
				id: task_id,
				status: "cancelled",
				summary: task.summary ?? "cancelled by caller",
			});
			if (config.onTerminal) {
				const finalRow = getTaskById(db, task_id);
				if (finalRow) config.onTerminal(finalRow, db);
			}
			return { ok: true, message: "cancellation requested" };
		},

		async list(): Promise<TaskSummary[]> {
			// List support needs a cross-session filter API in the store, deferred
			// to Issue #5 when the MCP list_tasks tool wires up. For v0 return [].
			// Reference syncLiveness to avoid unused-binding lint.
			void syncLiveness;
			return [];
		},
	};
}
