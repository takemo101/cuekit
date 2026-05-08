import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PaneBackend } from "@cuekit/adapters";
import { FakeTmuxRunner } from "@cuekit/adapters/testing";
import { buildTuiAdapterRegistry } from "../src/bin.ts";
import { classifyCuekitCommand, printMainHelp } from "../src/dispatch.ts";

const workspaceRoot = resolve(import.meta.dir, "..", "..", "..");

describe("cuekit CLI binary dispatch", () => {
	it("classifies human, reserved, MCP, and protocol commands", () => {
		expect(classifyCuekitCommand(["doctor"])).toEqual({ kind: "doctor" });
		expect(classifyCuekitCommand(["update"])).toEqual({ kind: "update" });
		expect(classifyCuekitCommand(["init"])).toEqual({ kind: "init" });
		expect(classifyCuekitCommand(["tui"])).toEqual({ kind: "tui" });
		expect(classifyCuekitCommand(["mcp", "config"])).toEqual({ kind: "mcp-config" });
		expect(classifyCuekitCommand(["--mcp"])).toEqual({ kind: "delegate" });
		expect(classifyCuekitCommand(["task", "submit"])).toEqual({ kind: "delegate" });
	});

	it("prints honest help for implemented commands only", () => {
		const help = printMainHelp();
		expect(help).toContain("cuekit init");
		expect(help).toContain("cuekit tui");
		expect(help).toContain("cuekit doctor");
		expect(help).toContain("cuekit update");
	});

	it("registers every shipped adapter in the TUI registry build-out", () => {
		// Regression for the gemini-not-attachable-from-TUI bug: `cuekit tui`
		// builds its own AdapterRegistry separate from the MCP server, and a
		// missing registration here makes tasks for that adapter look like
		// "Selected task is not attachable" inside the TUI even when the
		// pane is alive. Drive the actual factory and assert the registry's
		// kinds — string-grepping the source would silently survive a
		// reformat that drops a register() call.
		const db = new Database(":memory:");
		try {
			const panes = new PaneBackend({ runner: new FakeTmuxRunner(), sendKeysDelayMs: 0 });
			const registry = buildTuiAdapterRegistry(db, panes);

			expect(registry.kinds().sort()).toEqual(["claude-code", "gemini", "jcode", "opencode", "pi"]);
		} finally {
			db.close();
		}
	});

	it("publishes the root installed bin as a bundled @cuekit/cli entrypoint", () => {
		const rootPackage = JSON.parse(readFileSync(resolve(workspaceRoot, "package.json"), "utf8"));
		const cliPackage = JSON.parse(
			readFileSync(resolve(workspaceRoot, "packages/cli/package.json"), "utf8"),
		);
		const mcpPackage = JSON.parse(
			readFileSync(resolve(workspaceRoot, "packages/mcp/package.json"), "utf8"),
		);

		expect(rootPackage.bin?.cuekit).toBe("bin/cuekit.js");
		const bundledBin = readFileSync(resolve(workspaceRoot, "bin/cuekit.js"), "utf8");
		expect(bundledBin).toContain("#!/usr/bin/env bun");
		expect(bundledBin).toContain("cuekit doctor");
		expect(bundledBin).toContain("runTuiLoop");
		expect(bundledBin).not.toContain('var TUI_PACKAGE_NAME = "@cuekit/tui"');
		expect(bundledBin).not.toContain("await import(TUI_PACKAGE_NAME)");
		expect(cliPackage.bin?.cuekit).toBe("./src/bin.ts");
		expect(cliPackage.dependencies?.["@cuekit/mcp"]).toBe("workspace:*");
		expect(mcpPackage.bin?.cuekit).toBeUndefined();
		expect(mcpPackage.dependencies?.["@cuekit/cli"]).toBeUndefined();
	});
});
