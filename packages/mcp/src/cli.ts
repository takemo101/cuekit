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
	const groups = new Map<string, ReturnType<typeof Cli.create>>();

	for (const operation of CUEKIT_OPERATIONS) {
		const [group, leaf] = operation.cliPath;
		let groupCli = groups.get(group);
		if (!groupCli) {
			groupCli = Cli.create(group, {
				description: `${group} commands.`,
			});
			groups.set(group, groupCli);
		}
		registerOperation(groupCli, leaf, ctx, operation);
	}

	for (const groupCli of groups.values()) {
		cli.command(groupCli);
	}

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

// `incur` reserves `mcp` as a built-in top-level command for registration,
// so the real argv path `cuekit mcp config` must be handled before generic
// `serve()` dispatch. This small projection keeps the helper command on the
// designed CLI path without changing the MCP tool name (`show_mcp_config`).
export function createMcpConfigCli(ctx: CommandContext) {
	const cli = Cli.create("cuekit", {
		version: pkg.version,
		description: "cuekit — delegation substrate for coding agents.",
	});
	const operation = CUEKIT_OPERATIONS.find((entry) => entry.mcpName === "show_mcp_config");
	if (!operation) throw new Error("missing show_mcp_config operation");
	registerOperation(cli, "config", ctx, operation);
	return cli;
}
