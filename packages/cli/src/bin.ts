#!/usr/bin/env bun
import { runCuekitMcpBin } from "@cuekit/mcp";
import {
	classifyCuekitCommand,
	printDoctorHelp,
	printMainHelp,
	printUpdateHelp,
} from "./dispatch.ts";
import { runDoctor } from "./doctor.ts";
import { runUpdate } from "./update.ts";

export async function runCuekitCliBin(): Promise<void> {
	const argv = process.argv.slice(2);
	const classification = classifyCuekitCommand(argv);
	if (classification.kind === "help") {
		process.stdout.write(printMainHelp());
		return;
	}
	if (classification.kind === "doctor") {
		if (argv.includes("--help") || argv.includes("-h")) {
			process.stdout.write(printDoctorHelp());
			return;
		}
		const result = await runDoctor();
		process.stdout.write(result.stdout);
		if (result.stderr) process.stderr.write(result.stderr);
		process.exit(result.exitCode);
	}
	if (classification.kind === "update") {
		if (argv.includes("--help") || argv.includes("-h")) {
			process.stdout.write(printUpdateHelp());
			return;
		}
		const result = await runUpdate();
		process.stdout.write(result.stdout);
		if (result.stderr) process.stderr.write(result.stderr);
		process.exit(result.exitCode);
	}
	await runCuekitMcpBin();
}

if (import.meta.main) {
	await runCuekitCliBin();
}
