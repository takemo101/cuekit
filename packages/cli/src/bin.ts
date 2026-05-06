#!/usr/bin/env bun
import { runCuekitMcpBin } from "@cuekit/mcp";
import { classifyCuekitCommand, printMainHelp, printReservedHumanCommand } from "./dispatch.ts";

export async function runCuekitCliBin(): Promise<void> {
	const classification = classifyCuekitCommand(process.argv.slice(2));
	if (classification.kind === "help") {
		process.stdout.write(printMainHelp());
		return;
	}
	if (classification.kind === "reserved-human") {
		process.stderr.write(printReservedHumanCommand(classification.command));
		process.exit(1);
	}
	await runCuekitMcpBin();
}

if (import.meta.main) {
	await runCuekitCliBin();
}
