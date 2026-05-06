import { describe, expect, it } from "bun:test";
import { createDoctorExec, type DoctorExec, runDoctor } from "../src/doctor.ts";

const okExec: DoctorExec = async (command) => {
	if (command === "bun") return { ok: true, stdout: "1.3.11\n" };
	if (command === "tmux") return { ok: true, stdout: "tmux 3.5a\n" };
	return { ok: false, stderr: "not found" };
};

describe("cuekit doctor", () => {
	it("returns ok with warnings for non-blocking follow-up", async () => {
		const result = await runDoctor({
			cwd: "/repo",
			env: {},
			exec: okExec,
			checkWritableState: async () => ({ ok: true, path: "~/.cuekit/state.db" }),
			loadProjectConfig: () => ({ ok: true, source: "config", path: "/repo/.cuekit.yaml" }),
			getCurrentVersion: () => "v0.1.0",
			getLatestRelease: async () => ({ ok: true, tag: "v0.1.1" }),
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("✓ cuekit: v0.1.0");
		expect(result.stdout).toContain("✓ bun: 1.3.11");
		expect(result.stdout).toContain("✓ tmux: tmux 3.5a");
		expect(result.stdout).toContain("✓ state db: ~/.cuekit/state.db writable");
		expect(result.stdout).toContain("✓ project config: /repo/.cuekit.yaml");
		expect(result.stdout).toContain("✓ MCP config helper: cuekit mcp config");
		expect(result.stdout).toContain("! update: v0.1.1 available");
	});

	it("returns exit code 1 when a required local capability fails", async () => {
		const result = await runDoctor({
			cwd: "/repo",
			env: {},
			exec: async (command) =>
				command === "tmux" ? { ok: false, stderr: "not found" } : { ok: true, stdout: "1.3.11\n" },
			checkWritableState: async () => ({ ok: true, path: "~/.cuekit/state.db" }),
			loadProjectConfig: () => ({ ok: true, source: "git" }),
			getCurrentVersion: () => "v0.1.0",
			getLatestRelease: async () => ({ ok: false, reason: "offline" }),
		});

		expect(result.exitCode).toBe(1);
		expect(result.stdout).toContain("✗ tmux: not found");
		expect(result.stdout).toContain("! update: skipped (offline)");
	});

	it("reports invalid project config as a failure", async () => {
		const result = await runDoctor({
			cwd: "/repo",
			env: {},
			exec: okExec,
			checkWritableState: async () => ({ ok: true, path: "~/.cuekit/state.db" }),
			loadProjectConfig: () => ({ ok: false, error: "Invalid cuekit project config" }),
			getCurrentVersion: () => undefined,
			getLatestRelease: async () => ({ ok: false, reason: "offline" }),
		});

		expect(result.exitCode).toBe(1);
		expect(result.stdout).toContain("! cuekit: version unknown");
		expect(result.stdout).toContain("✗ project config: Invalid cuekit project config");
	});

	it("turns missing executables into fail results instead of throwing", async () => {
		const exec = createDoctorExec((command, args) => {
			throw new Error(`Executable not found in $PATH: ${command} ${args.join(" ")}`);
		});

		const result = await exec("tmux", ["-V"]);

		expect(result).toEqual({
			ok: false,
			stderr: "Executable not found in $PATH: tmux -V",
		});
	});

	it("suggests the implemented update command as a next step", async () => {
		const result = await runDoctor({
			cwd: "/repo",
			env: {},
			exec: okExec,
			checkWritableState: async () => ({ ok: true, path: "~/.cuekit/state.db" }),
			loadProjectConfig: () => ({ ok: true, source: "config", path: "/repo/.cuekit.yaml" }),
			getCurrentVersion: () => "v0.1.0",
			getLatestRelease: async () => ({ ok: true, tag: "v0.1.1" }),
		});

		expect(result.stdout).toContain("  cuekit update");
	});
});
