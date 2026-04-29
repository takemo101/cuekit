import { Cli } from "incur";
import pkg from "../package.json" with { type: "json" };
import type { CommandContext } from "./command-context.ts";
import { CUEKIT_OPERATIONS } from "./operations.ts";

// Builds the cuekit control surface. Operation handlers and Zod schemas live
// in a shared registry so the CLI and MCP projections can use names optimized
// for their callers. This preparatory projection still registers the legacy
// flat CLI names; follow-up work switches the human CLI to grouped paths while
// preserving flat MCP tool names.
export function createCli(ctx: CommandContext) {
	const cli = Cli.create("cuekit", {
		version: pkg.version,
		description: "cuekit — delegation substrate for coding agents.",
	});

	for (const operation of CUEKIT_OPERATIONS) {
		cli.command(operation.mcpName, {
			description: operation.description,
			options: operation.options,
			output: operation.output,
			run: ({ options }) => operation.run(ctx, options),
		});
	}

	return cli;
}
