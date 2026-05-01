import type { z } from "incur";
import type { CommandContext } from "./command-context.ts";
import {
	CancelTasksInputSchema,
	CancelTasksOutputSchema,
	runCancelTasks,
} from "./commands/cancel-task.ts";
import {
	CleanupTasksInputSchema,
	CleanupTasksOutputSchema,
	runCleanupTasks,
} from "./commands/cleanup-tasks.ts";
import {
	CreateTeamInputSchema,
	CreateTeamOutputSchema,
	runCreateTeam,
} from "./commands/create-team.ts";
import {
	DeleteSessionsInputSchema,
	DeleteSessionsOutputSchema,
	runDeleteSessions,
} from "./commands/delete-session.ts";
import {
	DeleteTasksInputSchema,
	DeleteTasksOutputSchema,
	runDeleteTasks,
} from "./commands/delete-task.ts";
import {
	GetTaskResultInputSchema,
	GetTaskResultOutputSchema,
	runGetTaskResult,
} from "./commands/get-task-result.ts";
import {
	GetTaskStatusInputSchema,
	GetTaskStatusOutputSchema,
	runGetTaskStatus,
} from "./commands/get-task-status.ts";
import {
	GetTeamStatusInputSchema,
	GetTeamStatusOutputSchema,
	runGetTeamStatus,
} from "./commands/get-team-status.ts";
import {
	ListAdaptersInputSchema,
	ListAdaptersOutputSchema,
	runListAdapters,
} from "./commands/list-adapters.ts";
import {
	ListAgentProfilesInputSchema,
	ListAgentProfilesOutputSchema,
	runListAgentProfiles,
} from "./commands/list-agent-profiles.ts";
import {
	ListTaskEventsInputSchema,
	ListTaskEventsOutputSchema,
	runListTaskEvents,
} from "./commands/list-task-events.ts";
import {
	ListTasksInputSchema,
	ListTasksOutputSchema,
	runListTasks,
} from "./commands/list-tasks.ts";
import {
	ListTeamsInputSchema,
	ListTeamsOutputSchema,
	runListTeams,
} from "./commands/list-teams.ts";
import {
	ReportTaskEventInputSchema,
	ReportTaskEventOutputSchema,
	runReportTaskEvent,
} from "./commands/report-task-event.ts";
import {
	runShowMcpConfig,
	ShowMcpConfigInputSchema,
	ShowMcpConfigOutputSchema,
} from "./commands/show-mcp-config.ts";
import {
	runSteerTask,
	SteerTaskInputSchema,
	SteerTaskOutputSchema,
} from "./commands/steer-task.ts";
import {
	runSubmitTask,
	SubmitTaskInputSchema,
	SubmitTaskOutputSchema,
} from "./commands/submit-task.ts";
import {
	runWaitTasks,
	WaitTasksInputSchema,
	WaitTasksOutputSchema,
} from "./commands/wait-tasks.ts";
export interface CuekitOperation<InputSchema extends z.ZodType, OutputSchema extends z.ZodType> {
	mcpName: string;
	cliPath: readonly [string, string];
	description: string;
	options: InputSchema;
	output: OutputSchema;
	run: (
		ctx: CommandContext,
		options: unknown,
	) => z.infer<OutputSchema> | Promise<z.infer<OutputSchema>>;
}

function defineOperation<InputSchema extends z.ZodType, OutputSchema extends z.ZodType>(
	operation: Omit<CuekitOperation<InputSchema, OutputSchema>, "run"> & {
		run: (
			ctx: CommandContext,
			options: z.infer<InputSchema>,
		) => z.infer<OutputSchema> | Promise<z.infer<OutputSchema>>;
	},
): CuekitOperation<InputSchema, OutputSchema> {
	return {
		...operation,
		run: (ctx, options) => operation.run(ctx, options as z.infer<InputSchema>),
	};
}

export const CUEKIT_OPERATIONS = [
	defineOperation({
		mcpName: "submit_task",
		cliPath: ["task", "submit"],
		description: "Submit a task to a target adapter.",
		options: SubmitTaskInputSchema,
		output: SubmitTaskOutputSchema,
		run: runSubmitTask,
	}),
	defineOperation({
		mcpName: "create_team",
		cliPath: ["team", "create"],
		description: "Create a session-scoped task team.",
		options: CreateTeamInputSchema,
		output: CreateTeamOutputSchema,
		run: runCreateTeam,
	}),
	defineOperation({
		mcpName: "list_teams",
		cliPath: ["team", "list"],
		description: "List task teams, optionally filtered by session or cwd.",
		options: ListTeamsInputSchema,
		output: ListTeamsOutputSchema,
		run: runListTeams,
	}),
	defineOperation({
		mcpName: "get_team_status",
		cliPath: ["team", "status"],
		description: "Fetch aggregate status and member tasks for a task team.",
		options: GetTeamStatusInputSchema,
		output: GetTeamStatusOutputSchema,
		run: runGetTeamStatus,
	}),
	defineOperation({
		mcpName: "get_task_status",
		cliPath: ["task", "status"],
		description: "Fetch the current status of a task.",
		options: GetTaskStatusInputSchema,
		output: GetTaskStatusOutputSchema,
		run: runGetTaskStatus,
	}),
	defineOperation({
		mcpName: "get_task_result",
		cliPath: ["task", "result"],
		description: "Collect the normalized result of a terminal task.",
		options: GetTaskResultInputSchema,
		output: GetTaskResultOutputSchema,
		run: runGetTaskResult,
	}),
	defineOperation({
		mcpName: "wait_tasks",
		cliPath: ["task", "wait"],
		description: "Wait for one or more tasks to become terminal by polling status.",
		options: WaitTasksInputSchema,
		output: WaitTasksOutputSchema,
		run: runWaitTasks,
	}),
	defineOperation({
		mcpName: "cancel_tasks",
		cliPath: ["task", "cancel"],
		description: "Cancel one or more active tasks.",
		options: CancelTasksInputSchema,
		output: CancelTasksOutputSchema,
		run: runCancelTasks,
	}),
	defineOperation({
		mcpName: "list_tasks",
		cliPath: ["task", "list"],
		description: "List tasks, optionally filtered by status / adapter / session / cwd.",
		options: ListTasksInputSchema,
		output: ListTasksOutputSchema,
		run: runListTasks,
	}),
	defineOperation({
		mcpName: "report_task_event",
		cliPath: ["tool", "report"],
		description: "Append a child-reported task event and apply terminal status reports.",
		options: ReportTaskEventInputSchema,
		output: ReportTaskEventOutputSchema,
		run: runReportTaskEvent,
	}),
	defineOperation({
		mcpName: "list_task_events",
		cliPath: ["task", "events"],
		description: "List durable child-reported events for a task.",
		options: ListTaskEventsInputSchema,
		output: ListTaskEventsOutputSchema,
		run: runListTaskEvents,
	}),
	defineOperation({
		mcpName: "list_adapters",
		cliPath: ["adapter", "list"],
		description: "List registered adapters and their capabilities.",
		options: ListAdaptersInputSchema,
		output: ListAdaptersOutputSchema,
		run: runListAdapters,
	}),
	defineOperation({
		mcpName: "list_agent_profiles",
		cliPath: ["agent", "list"],
		description: "List builtin, user, and project agent profiles.",
		options: ListAgentProfilesInputSchema,
		output: ListAgentProfilesOutputSchema,
		run: runListAgentProfiles,
	}),
	defineOperation({
		mcpName: "steer_task",
		cliPath: ["task", "steer"],
		description: "Send a steering message to a running task (best-effort).",
		options: SteerTaskInputSchema,
		output: SteerTaskOutputSchema,
		run: runSteerTask,
	}),
	defineOperation({
		mcpName: "show_mcp_config",
		cliPath: ["mcp", "config"],
		description: "Print the MCP-server stanza to paste into a client config.",
		options: ShowMcpConfigInputSchema,
		output: ShowMcpConfigOutputSchema,
		run: runShowMcpConfig,
	}),
	defineOperation({
		mcpName: "delete_tasks",
		cliPath: ["task", "delete"],
		description:
			"Delete one or more terminal task rows. Non-terminal tasks must be cancelled first.",
		options: DeleteTasksInputSchema,
		output: DeleteTasksOutputSchema,
		run: runDeleteTasks,
	}),
	defineOperation({
		mcpName: "cleanup_tasks",
		cliPath: ["task", "cleanup"],
		description: "Delete terminal tasks within a session or cwd without deleting the session.",
		options: CleanupTasksInputSchema,
		output: CleanupTasksOutputSchema,
		run: runCleanupTasks,
	}),
	defineOperation({
		mcpName: "delete_sessions",
		cliPath: ["session", "delete"],
		description:
			"Delete one or more sessions and their tasks. All child tasks in each session must be terminal before deletion.",
		options: DeleteSessionsInputSchema,
		output: DeleteSessionsOutputSchema,
		run: runDeleteSessions,
	}),
] as const;
