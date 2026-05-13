import { describe, expect, it } from "bun:test";
import { printUpdateHelp } from "../src/dispatch.ts";
import { runUpdate } from "../src/update.ts";

describe("cuekit update", () => {
	it("prints the exact Bun install command for the latest release", async () => {
		const result = await runUpdate({
			getCurrentVersion: () => "v0.1.0",
			getLatestRelease: async () => ({ ok: true, tag: "v0.1.1" }),
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Current: v0.1.0");
		expect(result.stdout).toContain("Latest:  v0.1.1");
		expect(result.stdout).toContain("bun remove -g cuekit-workspace");
		expect(result.stdout).toContain("bun install -g github:takemo101/cuekit#v0.1.1");
		expect(result.stdout).toContain("restart any MCP client");
	});

	it("prints a clearly labeled manual fallback when latest release lookup fails", async () => {
		const result = await runUpdate({
			getCurrentVersion: () => undefined,
			getLatestRelease: async () => ({ ok: false, reason: "offline" }),
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Current: unknown");
		expect(result.stdout).toContain("Could not fetch the latest release tag: offline");
		expect(result.stdout).toContain("Manual update pattern:");
		expect(result.stdout).toContain("bun install -g github:takemo101/cuekit#<release-tag>");
		expect(result.stdout).toContain("<release-tag> is a placeholder");
		expect(result.stdout).toContain("bun remove -g cuekit-workspace");
	});

	it("shows fallback when GitHub API returns malformed response", async () => {
		const result = await runUpdate({
			getCurrentVersion: () => "v0.1.0",
			getLatestRelease: async () => ({ ok: false, reason: "missing tag_name" }),
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Could not fetch the latest release tag: missing tag_name");
		expect(result.stdout).toContain("Manual update pattern:");
		expect(result.stdout).toContain("bun install -g github:takemo101/cuekit#<release-tag>");
		expect(result.stdout).toContain("<release-tag> is a placeholder");
		expect(result.stdout).not.toContain("bun install -g github:takemo101/cuekit#missing tag_name");
	});

	it("update.ts contains no spawn/exec invocations", async () => {
		const source = await Bun.file(new URL("../src/update.ts", import.meta.url)).text();
		// These patterns would indicate actual process execution, which must never appear in update.ts
		const forbidden = [
			"Bun.spawn",
			"child_process",
			"execSync",
			"execFile",
			"spawnSync",
			"exec(",
			"spawn(",
		];
		for (const pattern of forbidden) {
			expect(source).not.toContain(pattern);
		}
	});

	it("update --help shows usage information", () => {
		const help = printUpdateHelp();
		expect(help).toContain("cuekit update");
		expect(help).toContain("--help");
		expect(help).toContain("Usage:");
	});
});
