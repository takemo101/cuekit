import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { classifyCuekitCommand, printMainHelp } from "../src/dispatch.ts";

const workspaceRoot = resolve(import.meta.dir, "..", "..", "..");

describe("cuekit CLI binary dispatch", () => {
	it("classifies human, reserved, MCP, and protocol commands", () => {
		expect(classifyCuekitCommand(["doctor"])).toEqual({
			kind: "reserved-human",
			command: "doctor",
		});
		expect(classifyCuekitCommand(["update"])).toEqual({
			kind: "reserved-human",
			command: "update",
		});
		expect(classifyCuekitCommand(["init"])).toEqual({ kind: "delegate" });
		expect(classifyCuekitCommand(["tui"])).toEqual({ kind: "delegate" });
		expect(classifyCuekitCommand(["mcp", "config"])).toEqual({ kind: "delegate" });
		expect(classifyCuekitCommand(["--mcp"])).toEqual({ kind: "delegate" });
		expect(classifyCuekitCommand(["task", "submit"])).toEqual({ kind: "delegate" });
	});

	it("prints honest help for implemented commands only", () => {
		const help = printMainHelp();
		expect(help).toContain("cuekit init");
		expect(help).toContain("cuekit tui");
		expect(help).not.toContain("cuekit doctor");
		expect(help).not.toContain("cuekit update");
	});

	it("moves installed bin ownership to @cuekit/cli", () => {
		const rootPackage = JSON.parse(readFileSync(resolve(workspaceRoot, "package.json"), "utf8"));
		const cliPackage = JSON.parse(
			readFileSync(resolve(workspaceRoot, "packages/cli/package.json"), "utf8"),
		);
		const mcpPackage = JSON.parse(
			readFileSync(resolve(workspaceRoot, "packages/mcp/package.json"), "utf8"),
		);

		expect(rootPackage.bin?.cuekit).toBe("packages/cli/src/bin.ts");
		expect(cliPackage.bin?.cuekit).toBe("./src/bin.ts");
		expect(cliPackage.dependencies?.["@cuekit/mcp"]).toBe("workspace:*");
		expect(mcpPackage.bin?.cuekit).toBeUndefined();
		expect(mcpPackage.dependencies?.["@cuekit/cli"]).toBeUndefined();
	});
});
