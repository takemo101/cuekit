import type { AdapterCapabilities } from "./adapter-capabilities.ts";
import type { JobError } from "./job-error.ts";
import { type TerminalTaskResultStatus, TerminalTaskResultStatusSchema } from "./task-result.ts";
import type { TaskSpec } from "./task-spec.ts";
import type { TaskStatus } from "./task-status.ts";

// Single source of truth for terminal statuses — derived from the Zod schema
// so task-result.ts and task-lifecycle.ts cannot disagree.
const TERMINAL_STATUSES: ReadonlyArray<TaskStatus> = TerminalTaskResultStatusSchema.options;

export function isTerminalTaskStatus(status: TaskStatus): status is TerminalTaskResultStatus {
	return TERMINAL_STATUSES.includes(status);
}

export type LifecycleCheck = { ok: true } | { ok: false; error: JobError };

export function ensureCollectable(status: TaskStatus): LifecycleCheck {
	if (isTerminalTaskStatus(status)) {
		return { ok: true };
	}
	return {
		ok: false,
		error: {
			code: "invalid_state",
			message: `collect requires a terminal task state, got '${status}'`,
			retryable: false,
		},
	};
}

export function canCancelTask(status: TaskStatus): LifecycleCheck {
	if (isTerminalTaskStatus(status)) {
		return {
			ok: false,
			error: {
				code: "invalid_state",
				message: `task is already in terminal state '${status}', cannot cancel`,
				retryable: false,
			},
		};
	}
	return { ok: true };
}

// Allowed task state transitions, per protocol-spec §13.1. Terminal statuses
// have an empty outbound list — once terminal, no further transitions.
const ALLOWED_TRANSITIONS: Readonly<Record<TaskStatus, ReadonlyArray<TaskStatus>>> = {
	queued: ["running", "failed", "cancelled"],
	running: ["completed", "failed", "input_required", "blocked", "cancelled", "timed_out"],
	input_required: ["running", "failed", "cancelled", "timed_out"],
	blocked: ["running", "cancelled"],
	completed: [],
	failed: [],
	cancelled: [],
	timed_out: [],
};

export function validateTaskTransition(from: TaskStatus, to: TaskStatus): LifecycleCheck {
	if (!ALLOWED_TRANSITIONS[from].includes(to)) {
		return {
			ok: false,
			error: {
				code: "invalid_state",
				message: `task transition '${from}' → '${to}' is not allowed`,
				retryable: false,
				details: { from, to },
			},
		};
	}
	return { ok: true };
}

export function validateSpecAgainstCapabilities(
	spec: TaskSpec,
	caps: AdapterCapabilities,
): LifecycleCheck {
	if (spec.agent_kind !== caps.agent_kind) {
		return {
			ok: false,
			error: {
				code: "invalid_input",
				message: `spec.agent_kind '${spec.agent_kind}' does not match adapter '${caps.agent_kind}'`,
				retryable: false,
			},
		};
	}
	if (spec.model !== undefined) {
		if (!caps.supports_model_selection) {
			return {
				ok: false,
				error: {
					code: "invalid_input",
					message: `adapter '${caps.agent_kind}' does not support model selection`,
					retryable: false,
				},
			};
		}
		if (caps.available_models && !caps.available_models.includes(spec.model)) {
			return {
				ok: false,
				error: {
					code: "invalid_input",
					message: `model '${spec.model}' is not in available_models for '${caps.agent_kind}': [${caps.available_models.join(", ")}]`,
					retryable: false,
					details: {
						requested_model: spec.model,
						available_models: caps.available_models,
					},
				},
			};
		}
	}
	return { ok: true };
}
