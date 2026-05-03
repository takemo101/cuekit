import { z } from "incur";
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
	CleanupTeamInputSchema,
	CleanupTeamOutputSchema,
	runCleanupTeam,
} from "./commands/cleanup-team.ts";
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
	runSubmitTeamTasks,
	SubmitTeamTasksInputSchema,
	SubmitTeamTasksOutputSchema,
} from "./commands/submit-team-tasks.ts";
import {
	runWaitTasks,
	WaitTasksInputSchema,
	WaitTasksOutputSchema,
} from "./commands/wait-tasks.ts";
import { runWaitTeam, WaitTeamInputSchema, WaitTeamOutputSchema } from "./commands/wait-team.ts";
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

const GetStatusInputSchema = z
	.object({
		kind: z.enum(["task", "team"]).describe("Status target type."),
		task_id: z.string().min(1).optional().describe("Required when kind is task."),
		team_id: z.string().min(1).optional().describe("Required when kind is team."),
	})
	.passthrough();
const GetStatusOutputSchema = z.union([GetTaskStatusOutputSchema, GetTeamStatusOutputSchema]);

async function runGetStatus(
	ctx: CommandContext,
	input: z.infer<typeof GetStatusInputSchema>,
): Promise<z.infer<typeof GetStatusOutputSchema>> {
	if (input.kind === "task") return runGetTaskStatus(ctx, GetTaskStatusInputSchema.parse(input));
	return runGetTeamStatus(ctx, GetTeamStatusInputSchema.parse(input));
}

const WaitInputSchema = z
	.object({
		kind: z.enum(["tasks", "team"]).describe("Wait target type."),
		task_ids: z.array(z.string().min(1)).optional().describe("Required when kind is tasks."),
		team_id: z.string().min(1).optional().describe("Required when kind is team."),
		session_id: z.string().min(1).optional(),
		cwd: z.string().min(1).optional(),
		mode: z.enum(["all", "any"]).optional(),
		timeout_ms: z.number().int().min(0).optional(),
		poll_interval_ms: z.number().int().min(1).optional(),
		stop_on_failed: z.boolean().optional(),
		include_results: z.boolean().optional(),
		include_events: z.boolean().optional(),
		since_event_sequences: z.record(z.string(), z.number().int().min(0)).optional(),
	})
	.passthrough();
const WaitOutputSchema = z.union([WaitTasksOutputSchema, WaitTeamOutputSchema]);

async function runWait(
	ctx: CommandContext,
	input: z.infer<typeof WaitInputSchema>,
): Promise<z.infer<typeof WaitOutputSchema>> {
	if (input.kind === "tasks") return runWaitTasks(ctx, WaitTasksInputSchema.parse(input));
	return runWaitTeam(ctx, WaitTeamInputSchema.parse(input));
}

const ListInputSchema = z
	.object({
		kind: z
			.enum(["tasks", "teams", "events", "adapters", "agent_profiles"])
			.describe("Resource type to list."),
		task_id: z.string().min(1).optional().describe("Required when kind is events."),
		status: z.string().optional().describe("Task status filter when kind is tasks."),
		agent_kind: z.string().min(1).optional().describe("Adapter filter when kind is tasks."),
		session_id: z.string().min(1).optional().describe("Session filter for tasks or teams."),
		cwd: z.string().min(1).optional().describe("Worktree filter for tasks, teams, or profiles."),
		team_id: z.string().min(1).optional().describe("Team filter when kind is tasks."),
		position: z.string().optional().describe("Team position filter when kind is tasks."),
		limit: z.number().int().positive().optional(),
		cursor: z.string().optional(),
		include_instructions: z.boolean().optional().describe("Include profile instructions."),
		role_sources: z.array(z.enum(["builtin", "user", "project"])).optional(),
	})
	.passthrough();
const ListOutputSchema = z.union([
	ListTasksOutputSchema,
	ListTeamsOutputSchema,
	ListTaskEventsOutputSchema,
	ListAdaptersOutputSchema,
	ListAgentProfilesOutputSchema,
]);

async function runList(
	ctx: CommandContext,
	input: z.infer<typeof ListInputSchema>,
): Promise<z.infer<typeof ListOutputSchema>> {
	switch (input.kind) {
		case "tasks":
			return runListTasks(ctx, ListTasksInputSchema.parse(input));
		case "teams":
			return runListTeams(ctx, ListTeamsInputSchema.parse(input));
		case "events":
			return runListTaskEvents(ctx, ListTaskEventsInputSchema.parse(input));
		case "adapters":
			return runListAdapters(ctx, ListAdaptersInputSchema.parse(input));
		case "agent_profiles":
			return runListAgentProfiles(ctx, ListAgentProfilesInputSchema.parse(input));
	}
}

const CleanupInputSchema = z
	.object({
		kind: z.enum(["tasks", "team"]).describe("Cleanup target type."),
		team_id: z.string().min(1).optional().describe("Required when kind is team."),
		session_id: z.string().min(1).optional().describe("Task cleanup session scope."),
		cwd: z.string().min(1).optional().describe("Task cleanup cwd scope."),
		statuses: z.array(z.string()).optional().describe("Terminal statuses to clean up."),
		dry_run: z.boolean().optional(),
	})
	.passthrough();
const CleanupOutputSchema = z.union([CleanupTasksOutputSchema, CleanupTeamOutputSchema]);

async function runCleanup(
	ctx: CommandContext,
	input: z.infer<typeof CleanupInputSchema>,
): Promise<z.infer<typeof CleanupOutputSchema>> {
	if (input.kind === "tasks") return runCleanupTasks(ctx, CleanupTasksInputSchema.parse(input));
	return runCleanupTeam(ctx, CleanupTeamInputSchema.parse(input));
}

const DeleteInputSchema = z
	.object({
		kind: z.enum(["tasks", "sessions"]).describe("Delete target type."),
		task_ids: z.array(z.string().min(1)).optional().describe("Required when kind is tasks."),
		session_ids: z.array(z.string().min(1)).optional().describe("Required when kind is sessions."),
	})
	.passthrough();
const DeleteOutputSchema = z.union([DeleteTasksOutputSchema, DeleteSessionsOutputSchema]);

async function runDelete(
	ctx: CommandContext,
	input: z.infer<typeof DeleteInputSchema>,
): Promise<z.infer<typeof DeleteOutputSchema>> {
	if (input.kind === "tasks") return runDeleteTasks(ctx, DeleteTasksInputSchema.parse(input));
	return runDeleteSessions(ctx, DeleteSessionsInputSchema.parse(input));
}

export const CUEKIT_MCP_OPERATIONS = [
	defineOperation({
		mcpName: "submit_task",
		cliPath: ["task", "submit"],
		description: "Submit one task to an adapter.",
		options: SubmitTaskInputSchema,
		output: SubmitTaskOutputSchema,
		run: runSubmitTask,
	}),
	defineOperation({
		mcpName: "submit_team_tasks",
		cliPath: ["team", "submit"],
		description: "Submit multiple tasks into an existing team with best-effort per-task results.",
		options: SubmitTeamTasksInputSchema,
		output: SubmitTeamTasksOutputSchema,
		run: runSubmitTeamTasks,
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
		mcpName: "get_status",
		cliPath: ["get", "status"],
		description: "Fetch status for a task or team. Set kind to 'task' or 'team'.",
		options: GetStatusInputSchema,
		output: GetStatusOutputSchema,
		run: runGetStatus,
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
		mcpName: "wait",
		cliPath: ["wait", "target"],
		description: "Wait for tasks or a team. Set kind to 'tasks' or 'team'.",
		options: WaitInputSchema,
		output: WaitOutputSchema,
		run: runWait,
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
		mcpName: "list",
		cliPath: ["list", "resources"],
		description:
			"List resources. Set kind to 'tasks', 'teams', 'events', 'adapters', or 'agent_profiles'.",
		options: ListInputSchema,
		output: ListOutputSchema,
		run: runList,
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
		mcpName: "steer_task",
		cliPath: ["task", "steer"],
		description: "Send a steering message to a running task (best-effort).",
		options: SteerTaskInputSchema,
		output: SteerTaskOutputSchema,
		run: runSteerTask,
	}),
	defineOperation({
		mcpName: "cleanup",
		cliPath: ["cleanup", "target"],
		description: "Clean up terminal tasks by task scope or team. Set kind to 'tasks' or 'team'.",
		options: CleanupInputSchema,
		output: CleanupOutputSchema,
		run: runCleanup,
	}),
	defineOperation({
		mcpName: "delete",
		cliPath: ["delete", "target"],
		description: "Delete terminal tasks or sessions. Set kind to 'tasks' or 'sessions'.",
		options: DeleteInputSchema,
		output: DeleteOutputSchema,
		run: runDelete,
	}),
] as const;

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
		mcpName: "submit_team_tasks",
		cliPath: ["team", "submit"],
		description: "Submit multiple tasks into an existing team with best-effort per-task results.",
		options: SubmitTeamTasksInputSchema,
		output: SubmitTeamTasksOutputSchema,
		run: runSubmitTeamTasks,
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
		mcpName: "wait_team",
		cliPath: ["team", "wait"],
		description: "Wait for all or any snapshotted tasks in a team.",
		options: WaitTeamInputSchema,
		output: WaitTeamOutputSchema,
		run: runWaitTeam,
	}),
	defineOperation({
		mcpName: "cleanup_team",
		cliPath: ["team", "cleanup"],
		description: "Delete terminal tasks in a team while keeping the team row.",
		options: CleanupTeamInputSchema,
		output: CleanupTeamOutputSchema,
		run: runCleanupTeam,
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
