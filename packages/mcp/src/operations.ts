import type { z } from "incur";
import type { CommandContext } from "./command-context.ts";
import {
	CancelTaskInputSchema,
	CancelTaskOutputSchema,
	runCancelTask,
} from "./commands/cancel-task.ts";
import {
	DeleteSessionInputSchema,
	DeleteSessionOutputSchema,
	runDeleteSession,
} from "./commands/delete-session.ts";
import {
	DeleteTaskInputSchema,
	DeleteTaskOutputSchema,
	runDeleteTask,
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
	ListAdaptersInputSchema,
	ListAdaptersOutputSchema,
	runListAdapters,
} from "./commands/list-adapters.ts";
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
		mcpName: "cancel_task",
		cliPath: ["task", "cancel"],
		description: "Cancel an active task.",
		options: CancelTaskInputSchema,
		output: CancelTaskOutputSchema,
		run: runCancelTask,
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
		mcpName: "delete_task",
		cliPath: ["task", "delete"],
		description: "Delete a terminal task row. Non-terminal tasks must be cancelled first.",
		options: DeleteTaskInputSchema,
		output: DeleteTaskOutputSchema,
		run: runDeleteTask,
	}),
	defineOperation({
		mcpName: "delete_session",
		cliPath: ["session", "delete"],
		description:
			"Delete a session and its tasks. All child tasks must be terminal before deletion.",
		options: DeleteSessionInputSchema,
		output: DeleteSessionOutputSchema,
		run: runDeleteSession,
	}),
] as const;
