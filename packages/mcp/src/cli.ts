import { Cli } from "incur";
import pkg from "../package.json" with { type: "json" };
import type { CommandContext } from "./command-context.ts";
import {
	CancelTaskInputSchema,
	CancelTaskOutputSchema,
	runCancelTask,
} from "./commands/cancel-task.ts";
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
	ListTasksInputSchema,
	ListTasksOutputSchema,
	runListTasks,
} from "./commands/list-tasks.ts";
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

// Builds the cuekit control surface. The same command tree backs both the
// CLI (`cuekit submit_task ...`) and the MCP stdio server (`cuekit --mcp`)
// via incur. Callers inject runtime dependencies (db, registry) through
// ctx so the surface stays pure of environment assumptions.
//
// Command names are snake_case (not kebab) because incur uses the command
// name verbatim as the MCP tool name, and the cuekit spec mandates
// snake_case MCP tool names (`submit_task`, `get_task_status`, etc.).
// CLI invocation follows the same convention: `cuekit submit_task ...`.
export function createCli(ctx: CommandContext) {
	const cli = Cli.create("cuekit", {
		version: pkg.version,
		description: "cuekit — delegation substrate for coding agents.",
	});

	cli.command("submit_task", {
		description: "Submit a task to a target adapter.",
		options: SubmitTaskInputSchema,
		output: SubmitTaskOutputSchema,
		run: ({ options }) => runSubmitTask(ctx, options),
	});

	cli.command("get_task_status", {
		description: "Fetch the current status of a task.",
		options: GetTaskStatusInputSchema,
		output: GetTaskStatusOutputSchema,
		run: ({ options }) => runGetTaskStatus(ctx, options),
	});

	cli.command("get_task_result", {
		description: "Collect the normalized result of a terminal task.",
		options: GetTaskResultInputSchema,
		output: GetTaskResultOutputSchema,
		run: ({ options }) => runGetTaskResult(ctx, options),
	});

	cli.command("cancel_task", {
		description: "Cancel an active task.",
		options: CancelTaskInputSchema,
		output: CancelTaskOutputSchema,
		run: ({ options }) => runCancelTask(ctx, options),
	});

	cli.command("list_tasks", {
		description: "List tasks, optionally filtered by status / adapter / session / cwd.",
		options: ListTasksInputSchema,
		output: ListTasksOutputSchema,
		run: ({ options }) => runListTasks(ctx, options),
	});

	cli.command("list_adapters", {
		description: "List registered adapters and their capabilities.",
		options: ListAdaptersInputSchema,
		output: ListAdaptersOutputSchema,
		run: ({ options }) => runListAdapters(ctx, options),
	});

	cli.command("steer_task", {
		description: "Send a steering message to a running task (best-effort).",
		options: SteerTaskInputSchema,
		output: SteerTaskOutputSchema,
		run: ({ options }) => runSteerTask(ctx, options),
	});

	cli.command("show_mcp_config", {
		description: "Print the MCP-server stanza to paste into a client config.",
		options: ShowMcpConfigInputSchema,
		output: ShowMcpConfigOutputSchema,
		run: ({ options }) => runShowMcpConfig(ctx, options),
	});

	return cli;
}
