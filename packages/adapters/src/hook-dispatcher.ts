import type { HooksConfig, Logger, TaskStatus } from "@cuekit/core";
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

	/** Fire hook(s) for the given event if configured. Runs in parallel. */
	fire(event: string, env: Record<string, string>): void {
		const raw = this.hooks?.[event as keyof HooksConfig];
		if (!raw) return;
		const definitions = Array.isArray(raw) ? raw : [raw];
		// Spawn all hooks concurrently; each is fire-and-forget.
		for (const definition of definitions) {
			this.fireOne(event, definition, env);
		}
	}

	private expandEnvVars(command: string, env: Record<string, string>): string {
		return command.replace(
			/\$([A-Za-z_][A-Za-z0-9_]*)|\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g,
			(match, var1, var2) => {
				const key = var1 || var2;
				return env[key] ?? process.env[key] ?? match;
			},
		);
	}

	private fireOne(
		event: string,
		definition: { command: string; timeout?: number },
		env: Record<string, string>,
	): void {
		const timeoutMs = definition.timeout ? definition.timeout * 1000 : DEFAULT_HOOK_TIMEOUT_MS;
		const startTime = Date.now();
		const expandedCommand = this.expandEnvVars(definition.command, env);

		try {
			const proc = Bun.spawn(["/bin/sh", "-c", expandedCommand], {
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
				async (exitCode) => {
					clearTimeout(timeoutId);
					const duration = Date.now() - startTime;
					if (exitCode !== 0) {
						const stderrText = await new Response(proc.stderr).text();
						this.logger?.warn("hook exited with non-zero code", {
							event,
							exitCode,
							duration_ms: duration,
							stderr: stderrText,
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

	/** Canonical hook event names use config keys, not raw task statuses. */
	static taskEventName(status: TaskStatus): keyof HooksConfig | undefined {
		if (status === "running") return "on_task_start";
		if (status === "completed") return "on_task_complete";
		if (status === "failed") return "on_task_fail";
		if (status === "cancelled") return "on_task_cancel";
		if (status === "timed_out") return "on_task_timeout";
		if (status === "blocked") return "on_task_block";
		return undefined;
	}

	static teamEnv(team: {
		id: string;
		session_id: string;
		title: string;
		objective: string | null;
		metadata_json: string | null;
		created_at: string;
		updated_at: string;
	}): Record<string, string> {
		const env: Record<string, string> = {
			CUEKIT_EVENT: "",
			CUEKIT_TEAM_ID: team.id,
			CUEKIT_SESSION_ID: team.session_id,
			CUEKIT_OBJECTIVE: truncate(team.objective ?? team.title, 500),
		};
		const strategy = parseStrategyFromMetadata(team.metadata_json);
		if (strategy) env.CUEKIT_STRATEGY = strategy;
		const start = new Date(team.created_at).getTime();
		const end = new Date(team.updated_at).getTime();
		if (!Number.isNaN(start) && !Number.isNaN(end)) env.CUEKIT_DURATION_MS = String(end - start);
		return env;
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
	return `${value.slice(0, max - 3)}...`;
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

function parseStrategyFromMetadata(metadataJson: string | null): string | undefined {
	if (!metadataJson) return undefined;
	try {
		const metadata = JSON.parse(metadataJson) as Record<string, unknown>;
		const strategy = metadata.strategy;
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
