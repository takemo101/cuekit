import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDoctorExec, type DoctorExec, runDoctor } from "../src/doctor.ts";

const okExec: DoctorExec = async (command, args) => {
	if (command === "bun") return { ok: true, stdout: "1.3.11\n" };
	if (command === "tmux") {
		if (args[0] === "capture-pane") {
			// Real tmux returns exit 1 with this stderr when the target session
			// doesn't exist — that's the success path of doctor's probe (the
			// subcommand is recognised, just the fake target is missing).
			return { ok: false, stderr: "can't find session: cuekit-doctor-probe-no-such-session" };
		}
		return { ok: true, stdout: "tmux 3.5a\n" };
	}
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
		expect(result.stdout).toContain("✓ tmux capture-pane: supported");
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

	it("reports adapter executable availability as non-blocking warnings", async () => {
		const result = await runDoctor({
			cwd: "/repo",
			env: {},
			exec: async (command) => {
				if (command === "bun") return { ok: true, stdout: "1.3.11\n" };
				if (command === "tmux") return { ok: true, stdout: "tmux 3.5a\n" };
				if (command === "claude") return { ok: true, stdout: "1.0.0\n" };
				if (command === "jcode") return { ok: true, stdout: "jcode v0.9.0\n" };
				if (command === "gemini") return { ok: true, stdout: "0.41.1\n" };
				return { ok: false, stderr: "not found" };
			},
			checkWritableState: async () => ({ ok: true, path: "~/.cuekit/state.db" }),
			loadProjectConfig: () => ({ ok: true, source: "config", path: "/repo/.cuekit.yaml" }),
			getCurrentVersion: () => "v0.1.0",
			getLatestRelease: async () => ({ ok: false, reason: "offline" }),
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("✓ adapter claude-code: claude found");
		expect(result.stdout).toContain("! adapter pi: pi not found");
		expect(result.stdout).toContain("! adapter opencode: opencode not found");
		expect(result.stdout).toContain("✓ adapter jcode: jcode found");
		expect(result.stdout).toContain("✓ adapter gemini: gemini found");
	});

	it("reports gemini as not found when the binary is missing", async () => {
		const result = await runDoctor({
			cwd: "/repo",
			env: {},
			exec: async (command) => {
				if (command === "bun") return { ok: true, stdout: "1.3.11\n" };
				if (command === "tmux") return { ok: true, stdout: "tmux 3.5a\n" };
				return { ok: false, stderr: "not found" };
			},
			checkWritableState: async () => ({ ok: true, path: "~/.cuekit/state.db" }),
			loadProjectConfig: () => ({ ok: true, source: "config", path: "/repo/.cuekit.yaml" }),
			getCurrentVersion: () => "v0.1.0",
			getLatestRelease: async () => ({ ok: false, reason: "offline" }),
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("! adapter gemini: gemini not found");
	});

	it("treats matching package versions and v-prefixed release tags as up to date", async () => {
		const result = await runDoctor({
			cwd: "/repo",
			env: {},
			exec: okExec,
			checkWritableState: async () => ({ ok: true, path: "~/.cuekit/state.db" }),
			loadProjectConfig: () => ({ ok: true, source: "config", path: "/repo/.cuekit.yaml" }),
			getCurrentVersion: () => "0.0.1",
			getLatestRelease: async () => ({ ok: true, tag: "v0.0.1" }),
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("✓ update: up to date");
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

	it("reports structured herdr strict probe failure without fallback", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "cuekit-doctor-"));
		writeFileSync(
			join(cwd, ".cuekit.yaml"),
			"project:\n  id: doctor-test\nmultiplexer:\n  backend: herdr\n  strict: true\n",
		);

		const result = await runDoctor({
			cwd,
			env: {},
			exec: async (command) => {
				if (command === "bun") return { ok: true, stdout: "1.3.11\n" };
				if (command === "herdr") return { ok: false, stderr: "not found" };
				if (command === "tmux") return { ok: true, stdout: "tmux 3.5a\n" };
				return { ok: false, stderr: "not found" };
			},
			checkWritableState: async () => ({ ok: true, path: "~/.cuekit/state.db" }),
			loadProjectConfig: () => ({ ok: true, source: "config", path: join(cwd, ".cuekit.yaml") }),
			getCurrentVersion: () => "v0.1.0",
			getLatestRelease: async () => ({ ok: false, reason: "offline" }),
		});

		expect(result.exitCode).toBe(1);
		expect(result.stdout).toContain("✗ active backend: herdr unavailable (strict mode)");
		expect(result.stdout).toContain("✗ herdr: not found");
		expect(result.stdout).not.toContain("fallback from herdr");
	});

	it("reports structured zellij strict probe failure without fallback", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "cuekit-doctor-"));
		writeFileSync(
			join(cwd, ".cuekit.yaml"),
			"project:\n  id: doctor-test\nmultiplexer:\n  backend: zellij\n  strict: true\n",
		);

		const result = await runDoctor({
			cwd,
			env: {},
			exec: async (command) => {
				if (command === "bun") return { ok: true, stdout: "1.3.11\n" };
				if (command === "zellij") return { ok: false, stderr: "not found" };
				if (command === "tmux") return { ok: true, stdout: "tmux 3.5a\n" };
				return { ok: false, stderr: "not found" };
			},
			checkWritableState: async () => ({ ok: true, path: "~/.cuekit/state.db" }),
			loadProjectConfig: () => ({ ok: true, source: "config", path: join(cwd, ".cuekit.yaml") }),
			getCurrentVersion: () => "v0.1.0",
			getLatestRelease: async () => ({ ok: false, reason: "offline" }),
		});

		expect(result.exitCode).toBe(1);
		expect(result.stdout).toContain("✗ active backend: zellij unavailable (strict mode)");
		expect(result.stdout).toContain("✗ zellij: not found");
		expect(result.stdout).not.toContain("fallback from zellij");
	});
});
