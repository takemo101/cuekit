import { z } from "incur";
import type { CommandContext } from "../command-context.ts";

// Prints the MCP-server stanza an operator pastes into their client
// (Claude Code / Claude Desktop / Cursor — they all share the same
// `mcpServers` shape). Kept side-effect-free: never writes files, never
// shells out to the host client. The operator takes the emitted
// `mcpServers` object and drops it into their config themselves — that
// keeps the command safe to call via the MCP surface itself (no risk
// of a tool re-configuring its own host) and consistent across clients
// with divergent config locations.

export const ShowMcpConfigInputSchema = z.object({
	// Key under `mcpServers` that the server will be registered as.
	// Defaults to "cuekit" — override for side-by-side installs.
	name: z.string().optional(),
	// Executable name or absolute path. Defaults to "cuekit" on the
	// assumption the binary is on PATH (the usual install shape). Pass
	// an absolute path for uninstalled / workspace-linked checkouts.
	bin: z.string().optional(),
});

export type ShowMcpConfigInput = z.infer<typeof ShowMcpConfigInputSchema>;

export const ShowMcpConfigOutputSchema = z.object({
	name: z.string(),
	command: z.string(),
	args: z.array(z.string()),
	// Paste-ready snippet. Operator merges this into the `mcpServers`
	// map of their client config.
	mcpServers: z.record(
		z.string(),
		z.object({
			command: z.string(),
			args: z.array(z.string()),
		}),
	),
});

export type ShowMcpConfigOutput = z.infer<typeof ShowMcpConfigOutputSchema>;

export async function runShowMcpConfig(
	_ctx: CommandContext,
	input: ShowMcpConfigInput,
): Promise<ShowMcpConfigOutput> {
	const name = input.name ?? "cuekit";
	const command = input.bin ?? "cuekit";
	const args = ["--mcp"];
	return {
		name,
		command,
		args,
		mcpServers: { [name]: { command, args } },
	};
}
