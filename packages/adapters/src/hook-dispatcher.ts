import type { HooksConfig, Logger } from "@cuekit/core";
import type { Task } from "@cuekit/store";

const DEFAULT_HOOK_TIMEOUT_MS = 30_000;

/**
 * HookDispatcher — fire-and-forget shell command runner for cuekit lifecycle events.
 *
 * Hooks are executed asynchronously and never block the main workflow.
 * Errors are logged as warnings but never propagated.
 */
export class HookDispatcher {
	constructor(
		private readonly hooks: HooksConfig | undefined,
		private readonly logger: Logger | undefined,
	) {}

	/** Fire a hook for the given event if one is configured. */
	fire(event: string, env: Record<string, string>): void {
		const definition = this.hooks?.[event as keyof HooksConfig];
		if (!definition) return;

		const timeoutMs = definition.timeout ? definition.timeout * 1000 : DEFAULT_HOOK_TIMEOUT_MS;
		const startTime = Date.now();

		try {
			const proc = Bun.spawn(["/bin/sh", "-c", definition.command], {
				env: { ...process.env, ...env },
				stdout: "pipe",
				stderr: "pipe",
			});

			// Timeout kill
			const timeoutId = setTimeout(() => {
				try {
					proc.kill("SIGTERM");
				} catch {
					// ignore
				}
			}, timeoutMs);

			proc.exited.then(
				(exitCode) => {
					clearTimeout(timeoutId);
					const duration = Date.now() - startTime;
					if (exitCode !== 0) {
						this.logger?.warn("hook exited with non-zero code", {
							event,
							exitCode,
							duration_ms: duration,
						});
					}
				},
				(error) => {
					clearTimeout(timeoutId);
					this.logger?.warn("hook failed", {
						event,
						reason: error instanceof Error ? error.message : String(error),
						duration_ms: Date.now() - startTime,
					});
				},
			);
		} catch (error) {
			this.logger?.warn("hook spawn failed", {
				event,
				reason: error instanceof Error ? error.message : String(error),
			});
		}
	}

	/** Build environment variables from a terminal task. */
	static taskEnv(task: Task): Record<string, string> {
		const env: Record<string, string> = {
			CUEKIT_EVENT: "",
			CUEKIT_TASK_ID: task.id,
			CUEKIT_STATUS: task.status,
			CUEKIT_AGENT_KIND: task.agent_kind,
			CUEKIT_SESSION_ID: task.session_id,
		};

		if (task.model) env.CUEKIT_AGENT_MODEL = task.model;
		if (task.objective) env.CUEKIT_OBJECTIVE = truncate(task.objective, 500);
		if (task.team_id) env.CUEKIT_TEAM_ID = task.team_id;
		if (task.team_position) env.CUEKIT_POSITION = task.team_position;
		const strategy = parseStrategyFromSpec(task.spec_json);
		if (strategy) env.CUEKIT_STRATEGY = strategy;

		const duration = taskDurationMs(task);
		if (duration !== undefined) env.CUEKIT_DURATION_MS = String(duration);

		return env;
	}
}

function truncate(value: string, max: number): string {
	if (value.length <= max) return value;
	return value.slice(0, max - 3) + "...";
}

function parseStrategyFromSpec(specJson: string | null): string | undefined {
	if (!specJson) return undefined;
	try {
		const spec = JSON.parse(specJson) as Record<string, unknown>;
		const strategy = spec.strategy;
		return typeof strategy === "string" && strategy.length > 0 ? strategy : undefined;
	} catch {
		return undefined;
	}
}

function taskDurationMs(task: Task): number | undefined {
	if (!task.started_at || !task.updated_at) return undefined;
	const start = new Date(task.started_at).getTime();
	const end = new Date(task.updated_at).getTime();
	if (Number.isNaN(start) || Number.isNaN(end)) return undefined;
	return end - start;
}
