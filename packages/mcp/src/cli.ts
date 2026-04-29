import { Cli } from "incur";
import pkg from "../package.json" with { type: "json" };
import type { CommandContext } from "./command-context.ts";
import { CUEKIT_OPERATIONS } from "./operations.ts";

type CuekitOperation = (typeof CUEKIT_OPERATIONS)[number];

function registerOperation(
	cli: ReturnType<typeof Cli.create>,
	name: string,
	ctx: CommandContext,
	operation: CuekitOperation,
) {
	cli.command(name, {
		description: operation.description,
		options: operation.options,
		output: operation.output,
		run: ({ options }) => operation.run(ctx, options),
	});
}

// Builds the human CLI projection. Operation handlers and Zod schemas live in
// a shared registry so CLI names can be grouped for humans while MCP names stay
// flat for tool-using agents.
export function createCli(ctx: CommandContext) {
	const cli = Cli.create("cuekit", {
		version: pkg.version,
		description: "cuekit — delegation substrate for coding agents.",
	});
	const taskCli = Cli.create("task", {
		description: "Task lifecycle commands.",
	});

	for (const operation of CUEKIT_OPERATIONS) {
		const [group, leaf] = operation.cliPath;
		if (group === "task") {
			registerOperation(taskCli, leaf, ctx, operation);
		} else {
			registerOperation(cli, operation.mcpName, ctx, operation);
		}
	}

	cli.command(taskCli);

	return cli;
}

// Builds the MCP projection. MCP tool names intentionally remain flat
// snake_case because tool names are the protocol-facing contract.
export function createMcpCli(ctx: CommandContext) {
	const cli = Cli.create("cuekit", {
		version: pkg.version,
		description: "cuekit — delegation substrate for coding agents.",
	});

	for (const operation of CUEKIT_OPERATIONS) {
		registerOperation(cli, operation.mcpName, ctx, operation);
	}

	return cli;
}
