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
// CLI (`cuekit submit-task ...`) and the MCP stdio server (`cuekit --mcp`)
// via incur. Callers inject runtime dependencies (db, registry) through
// ctx so the surface stays pure of environment assumptions.
export function createCli(ctx: CommandContext) {
	const cli = Cli.create("cuekit", {
		version: pkg.version,
		description: "cuekit — delegation substrate for coding agents.",
	});

	cli.command("submit-task", {
		description: "Submit a task to a target adapter.",
		options: SubmitTaskInputSchema,
		output: SubmitTaskOutputSchema,
		run: ({ options }) => runSubmitTask(ctx, options),
	});

	cli.command("get-task-status", {
		description: "Fetch the current status of a task.",
		options: GetTaskStatusInputSchema,
		output: GetTaskStatusOutputSchema,
		run: ({ options }) => runGetTaskStatus(ctx, options),
	});

	cli.command("get-task-result", {
		description: "Collect the normalized result of a terminal task.",
		options: GetTaskResultInputSchema,
		output: GetTaskResultOutputSchema,
		run: ({ options }) => runGetTaskResult(ctx, options),
	});

	cli.command("cancel-task", {
		description: "Cancel an active task.",
		options: CancelTaskInputSchema,
		output: CancelTaskOutputSchema,
		run: ({ options }) => runCancelTask(ctx, options),
	});

	cli.command("list-tasks", {
		description: "List tasks, optionally filtered by status / adapter / session / cwd.",
		options: ListTasksInputSchema,
		output: ListTasksOutputSchema,
		run: ({ options }) => runListTasks(ctx, options),
	});

	cli.command("list-adapters", {
		description: "List registered adapters and their capabilities.",
		options: ListAdaptersInputSchema,
		output: ListAdaptersOutputSchema,
		run: ({ options }) => runListAdapters(ctx, options),
	});

	cli.command("steer-task", {
		description: "Send a steering message to a running task (best-effort).",
		options: SteerTaskInputSchema,
		output: SteerTaskOutputSchema,
		run: ({ options }) => runSteerTask(ctx, options),
	});

	return cli;
}
