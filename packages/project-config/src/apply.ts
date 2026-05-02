import type { TaskSpec } from "@cuekit/core";
import type { CuekitProjectConfig } from "./schema.ts";

export interface SubmitDefaultsInput {
	role?: string;
	agent_kind?: string;
	model?: string;
	timeout_ms?: number;
	priority?: "low" | "normal" | "high";
	adapter_options?: Record<string, unknown>;
}

export interface ApplySubmitDefaultsResult {
	role?: string;
	agent_kind?: string;
	model?: string;
	timeout_ms?: number;
	priority?: "low" | "normal" | "high";
	adapter_options?: Record<string, unknown>;
	role_from_config: boolean;
	agent_from_config: boolean;
}

export function safeAdapterOptions(): Record<string, unknown> {
	return { dangerously_skip_permissions: false };
}

export function applySubmitDefaults(
	input: SubmitDefaultsInput,
	config: CuekitProjectConfig,
): ApplySubmitDefaultsResult {
	const role_from_config = input.role === undefined && config.submit?.role !== undefined;
	const agent_from_config = input.agent_kind === undefined && config.submit?.agent !== undefined;
	return {
		role: input.role ?? config.submit?.role,
		agent_kind: input.agent_kind ?? config.submit?.agent,
		model: input.model ?? config.submit?.model,
		timeout_ms: input.timeout_ms ?? config.submit?.timeout_ms,
		priority: input.priority ?? config.submit?.priority,
		adapter_options: input.adapter_options,
		role_from_config,
		agent_from_config,
	};
}

export function shouldForceSafeAdapterOptions(input: {
	config: CuekitProjectConfig;
	agent_kind: string;
	caller_supplied_adapter_options: boolean;
	role_from_config: boolean;
	agent_from_config: boolean;
}): boolean {
	if (input.caller_supplied_adapter_options) return false;
	if (input.role_from_config || input.agent_from_config) return true;
	return input.config.adapters?.[input.agent_kind]?.permissions === "prompt";
}

export function applySafeAdapterOptions(spec: Partial<TaskSpec>): Partial<TaskSpec> {
	return {
		...spec,
		adapter_options: {
			...(spec.adapter_options ?? {}),
			...safeAdapterOptions(),
		},
	};
}
