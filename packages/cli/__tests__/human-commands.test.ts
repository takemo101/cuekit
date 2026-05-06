import { describe, expect, it } from "bun:test";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyCuekitCommand } from "../src/dispatch.ts";
import { runInitCommand, runJcodeMcpAddCommand } from "../src/human-commands.ts";

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

	it("registers cuekit in jcode global MCP config", () => {
		const home = mkdtempSync(`${tmpdir()}/cuekit-jcode-home-`);
		try {
			const result = runJcodeMcpAddCommand(["--agent", "jcode"], { home, cwd: "/repo" });
			const configPath = join(home, ".jcode", "mcp.json");
			const config = JSON.parse(readFileSync(configPath, "utf8"));

			expect(result.exitCode).toBe(0);
			expect(result.shouldDelegate).toBe(false);
			expect(result.stdout).toContain(`Registered MCP server 'cuekit' for jcode: ${configPath}`);
			expect(config).toEqual({
				servers: {
					cuekit: {
						command: "cuekit",
						args: ["--mcp"],
						env: {},
						shared: true,
					},
				},
			});
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	it("preserves existing jcode servers and file permissions", () => {
		const home = mkdtempSync(`${tmpdir()}/cuekit-jcode-existing-`);
		try {
			const configDir = join(home, ".jcode");
			const configPath = join(configDir, "mcp.json");
			mkdirSync(configDir, { recursive: true });
			writeFileSync(
				configPath,
				JSON.stringify({
					servers: { filesystem: { command: "fs", args: [], env: {}, shared: true } },
				}),
			);
			chmodSync(configPath, 0o640);

			runJcodeMcpAddCommand(["--agent", "jcode"], { home, cwd: "/repo" });
			const config = JSON.parse(readFileSync(configPath, "utf8"));

			expect(config.servers.filesystem.command).toBe("fs");
			expect(config.servers.cuekit.command).toBe("cuekit");
			expect(statSync(configPath).mode & 0o777).toBe(0o640);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	it("registers cuekit in jcode project MCP config with --no-global", () => {
		const cwd = mkdtempSync(`${tmpdir()}/cuekit-jcode-project-`);
		try {
			const result = runJcodeMcpAddCommand(["--agent", "jcode", "--no-global"], {
				home: "/home/user",
				cwd,
			});
			const configPath = join(cwd, ".jcode", "mcp.json");
			const config = JSON.parse(readFileSync(configPath, "utf8"));

			expect(result.exitCode).toBe(0);
			expect(result.shouldDelegate).toBe(false);
			expect(config.servers.cuekit.command).toBe("cuekit");
			expect(config.servers.cuekit.args).toEqual(["--mcp"]);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
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
