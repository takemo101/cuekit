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

/** Configurable hook events */
export interface HooksConfig {
	/** Fired after a task reaches terminal status `completed` */
	on_task_complete?: HookDefinition;
	/** Fired after a task reaches terminal status `failed` */
	on_task_fail?: HookDefinition;
	/** Fired after a task is cancelled */
	on_task_cancel?: HookDefinition;
	/** Fired after a task reaches terminal status `timed_out` */
	on_task_timeout?: HookDefinition;
	/** Fired after a team starts (coordinator submitted) */
	on_team_start?: HookDefinition;
	/** Fired after all team tasks reach a terminal status */
	on_team_complete?: HookDefinition;
}

/** Environment variables passed to every hook invocation */
export interface HookEnv {
	/** Event name, e.g. `on_task_complete` */
	CUEKIT_EVENT: string;
	/** Task ID */
	CUEKIT_TASK_ID: string;
	/** Terminal status (`completed`, `failed`, `cancelled`, `timed_out`) */
	CUEKIT_STATUS?: string;
	/** Agent kind, e.g. `claude-code` */
	CUEKIT_AGENT_KIND?: string;
	/** Model identifier */
	CUEKIT_AGENT_MODEL?: string;
	/** Task objective (truncated to 500 chars) */
	CUEKIT_OBJECTIVE?: string;
	/** Team ID (if applicable) */
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
