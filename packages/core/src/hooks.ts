/**
 * Hook definitions for cuekit lifecycle events.
 *
 * Hooks are fire-and-forget shell commands executed asynchronously
 * when tasks or teams reach lifecycle milestones. They never block
 * the main workflow and never fail the main operation.
 */

export interface HookDefinition {
	/** Shell command executed via /bin/sh -c */
	command: string;
	/** Timeout in seconds (default: 30) */
	timeout?: number;
}

/** Configurable hook events. Each event accepts a single definition or an array. */
export interface HooksConfig {
	on_task_start?: HookDefinition | HookDefinition[];
	on_task_complete?: HookDefinition | HookDefinition[];
	on_task_fail?: HookDefinition | HookDefinition[];
	on_task_cancel?: HookDefinition | HookDefinition[];
	on_task_timeout?: HookDefinition | HookDefinition[];
	on_task_block?: HookDefinition | HookDefinition[];
	on_team_start?: HookDefinition | HookDefinition[];
	on_team_complete?: HookDefinition | HookDefinition[];
}

/** Environment variables passed to every hook invocation */
export interface HookEnv {
	/** Event name, e.g. `on_task_complete` */
	CUEKIT_EVENT: string;
	/** Task ID (task hooks only) */
	CUEKIT_TASK_ID?: string;
	/** Task status (`running`, `completed`, `failed`, `cancelled`, `timed_out`, `blocked`) */
	CUEKIT_STATUS?: string;
	/** Agent kind, e.g. `claude-code` */
	CUEKIT_AGENT_KIND?: string;
	/** Model identifier */
	CUEKIT_AGENT_MODEL?: string;
	/** Task objective (truncated to 500 chars) */
	CUEKIT_OBJECTIVE?: string;
	/** Team ID (team hooks, or task hooks for team members) */
	CUEKIT_TEAM_ID?: string;
	/** Team strategy name */
	CUEKIT_STRATEGY?: string;
	/** Team position, e.g. `coordinator` */
	CUEKIT_POSITION?: string;
	/** Project ID from `.cuekit.yaml` */
	CUEKIT_PROJECT_ID?: string;
	/** Session ID */
	CUEKIT_SESSION_ID?: string;
	/** Duration in milliseconds */
	CUEKIT_DURATION_MS?: string;
}
