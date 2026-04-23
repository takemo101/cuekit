import type { AdapterCapabilities } from "./adapter-capabilities.ts";
import type { JobError } from "./job-error.ts";
import type { TaskSpec } from "./task-spec.ts";
import type { TaskStatus } from "./task-status.ts";

const TERMINAL_STATUSES: readonly TaskStatus[] = [
	"completed",
	"failed",
	"cancelled",
	"timed_out",
	"blocked",
];

export function isTerminalTaskStatus(status: TaskStatus): boolean {
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

export function validateSpecAgainstCapabilities(
	spec: TaskSpec,
	caps: AdapterCapabilities,
): LifecycleCheck {
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
