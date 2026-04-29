import type {
	Ack,
	AdapterCapabilities,
	JobError,
	SteeringMessage,
	TaskHandle,
	TaskListFilter,
	TaskResult,
	TaskSpec,
	TaskStatusView,
	TaskSummary,
} from "@cuekit/core";

export interface AdapterSubmitInput {
	spec: TaskSpec;
	session_id: string;
}

export type AdapterResult<T> = { ok: true; value: T } | { ok: false; error: JobError };

// Concrete adapter interface used by the control surface. Conceptually maps
// to `AgentAdapter` in the protocol spec §14.1. Methods that can fail
// recoverably (submit, collect) return `AdapterResult`; steer/cancel return
// the protocol's `Ack`; status always returns a view with any error embedded.
export interface AgentAdapter {
	readonly kind: string;
	capabilities(): AdapterCapabilities;
	submit(input: AdapterSubmitInput): Promise<AdapterResult<TaskHandle>>;
	status(task_id: string): Promise<TaskStatusView>;
	steer(message: SteeringMessage): Promise<Ack>;
	collect(task_id: string): Promise<AdapterResult<TaskResult>>;
	cancel(task_id: string): Promise<Ack>;
	list(filter?: TaskListFilter): Promise<TaskSummary[]>;
	// Optional: release runtime resources (e.g., tmux session) without changing
	// the task's DB status. Called by delete_task / delete_session before removing
	// DB records so that orphaned panes don't accumulate after cleanup.
	cleanup?(task_id: string): Promise<void>;
}

// Generates a short, unique task_id used as both the primary key and the
// tmux session name suffix (via PaneBackend).
export function generateTaskId(): string {
	return `t_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}
