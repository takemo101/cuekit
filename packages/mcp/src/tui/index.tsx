import type { CommandContext } from "../command-context.ts";

export function printTuiHelp(): void {
	process.stdout.write(`cuekit tui — interactive task cockpit

Usage: cuekit tui

Keys: ↑/↓ select, r refresh, a attach, s steer, c cancel, d delete, q quit
`);
}

export async function runTui(_ctx: CommandContext): Promise<void> {
	process.stdout.write("cuekit tui is not implemented yet\n");
}
