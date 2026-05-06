import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { classifyCuekitCommand } from "../src/dispatch.ts";
import { runInitCommand } from "../src/human-commands.ts";

describe("human setup command ownership", () => {
	it("classifies setup helpers as CLI-owned human commands", () => {
		expect(classifyCuekitCommand(["init"])).toEqual({ kind: "init" });
		expect(classifyCuekitCommand(["tui"])).toEqual({ kind: "tui" });
		expect(classifyCuekitCommand(["mcp", "config"])).toEqual({ kind: "mcp-config" });
		expect(classifyCuekitCommand(["mcp", "add", "--agent", "pi"])).toEqual({ kind: "mcp-add" });
	});

	it("runs init dry-run without writing files", () => {
		const result = runInitCommand(["--dry-run", "--no-gitignore"], {
			cwd: "/repo",
			runProjectConfigInit: (input) => ({
				cwd: input.cwd,
				configPath: "/repo/.cuekit.yaml",
				gitignorePath: "/repo/.gitignore",
				dryRun: input.dryRun ?? false,
				created: [".cuekit.yaml"],
				updated: [],
				skipped: [".gitignore"],
			}),
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("dry-run: cuekit init would update /repo");
		expect(result.stdout).toContain("dry-run: created .cuekit.yaml");
		expect(result.stdout).toContain("dry-run: skipped .gitignore");
	});

	it("returns structured init failures", () => {
		const result = runInitCommand([], {
			runProjectConfigInit: () => {
				throw new Error(".cuekit.yaml already exists");
			},
		});

		expect(result).toEqual({
			exitCode: 1,
			stdout: "",
			stderr: ".cuekit.yaml already exists\n",
		});
	});

	it("keeps human setup helper ownership out of @cuekit/mcp bin", () => {
		const mcpBin = readFileSync("packages/mcp/src/bin.ts", "utf8");
		expect(mcpBin).not.toContain("runProjectConfigInit");
		expect(mcpBin).not.toContain("ProjectConfigInitResult");
		expect(mcpBin).not.toContain("TUI_PACKAGE_NAME");
		expect(mcpBin).not.toContain("registerPiMcpServer");
		expect(mcpBin).not.toContain("printInitHelp");
		expect(mcpBin).not.toContain("printTuiHelp");
	});

	it("preserves dependency direction: @cuekit/mcp source never imports @cuekit/cli", () => {
		const files = collectTsFiles("packages/mcp/src");
		for (const file of files) {
			const source = readFileSync(file, "utf8");
			expect(source, file).not.toContain("@cuekit/cli");
		}
	});
});

function collectTsFiles(root: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(root)) {
		const path = join(root, entry);
		const stat = statSync(path);
		if (stat.isDirectory()) files.push(...collectTsFiles(path));
		else if (path.endsWith(".ts")) files.push(path);
	}
	return files;
}
