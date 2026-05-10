import { beforeEach, describe, expect, it } from "bun:test";
import { FakeZellijRunner } from "../src/testing.ts";
import { ZellijBackend } from "../src/zellij-backend.ts";

let runner: FakeZellijRunner;
let panes: ZellijBackend;
beforeEach(() => {
	runner = new FakeZellijRunner();
	panes = new ZellijBackend({ runner, sendKeysDelayMs: 0, paneMissingGraceMs: 0 });
});

describe("sessionNameFor / attachCommand", () => {
	it("builds the flat 'ct-{id}' name", () => {
		expect(panes.sessionNameFor("t_abc")).toBe("ct-t_abc");
	});

	it("builds compact team session names when a task was spawned in a team", async () => {
		await panes.spawnPane({
			task_id: "t_team",
			team_id: "tm_123456789abc",
			command: "sleep 60",
			cwd: "/tmp",
		});

		expect(panes.sessionNameFor("t_team")).toBe("ctm-123456789abc");
		expect(panes.attachCommand("t_team")).toEqual({
			argv: ["zellij", "attach", "ctm-123456789abc"],
		});
	});

	it("returns a structured zellij attach argv", () => {
		expect(panes.attachCommand("t_abc")).toEqual({
			argv: ["zellij", "attach", "ct-t_abc"],
		});
	});

	it("restores persisted team pane handles after a process restart", async () => {
		panes.restorePaneHandle({
			task_id: "t_restored",
			backend_kind: "zellij",
			backend_session: "ctm-restored",
			backend_pane_id: "ctm-restored/terminal_3",
			backend_label: "worker:t_restored",
		});

		expect(panes.sessionNameFor("t_restored")).toBe("ctm-restored");
		expect(panes.attachCommand("t_restored")).toEqual({
			argv: ["zellij", "attach", "ctm-restored"],
		});

		await panes.sendKeys("t_restored", "hello restored");
		expect(runner.calls.at(-2)).toEqual([
			"--session",
			"ctm-restored",
			"action",
			"write-chars",
			"-p",
			"terminal_3",
			"hello restored",
		]);

		await panes.markPaneTerminal("t_restored", "completed");
		expect(runner.calls.at(-1)).toEqual([
			"--session",
			"ctm-restored",
			"action",
			"rename-pane",
			"-p",
			"terminal_3",
			"worker:t_restored [completed]",
		]);
	});
});

describe("spawnPane", () => {
	it("creates a background session from a command layout and returns a structured handle", async () => {
		const handle = await panes.spawnPane({
			task_id: "t_abc",
			command: "sleep 60",
			cwd: "/tmp",
		});
		expect(handle.task_id).toBe("t_abc");
		expect(handle.backend_kind).toBe("zellij");
		expect(handle.backend_session).toBe("ct-t_abc");
		// Synthetic pane id (0.43 has no runtime stdout pane id).
		expect(handle.backend_pane_id).toBe("ct-t_abc/pane");

		// Background-create call shape. Use a default layout rather than a follow-up
		// `action new-pane`: zellij 0.43 cannot reliably apply actions to fully
		// detached sessions with no connected clients.
		const create = runner.calls.find((c) => c[0] === "attach");
		expect(create?.slice(0, 7)).toEqual([
			"attach",
			"--create-background",
			"ct-t_abc",
			"options",
			"--default-cwd",
			"/tmp",
			"--default-layout",
		]);

		const layout = runner.lastLayout();
		expect(layout).toContain('pane command="sh" cwd="/tmp" close_on_exit=true');
		const launchScriptPath = layout.match(/args "([^"]+launch\.sh)"/)?.[1];
		expect(launchScriptPath).toBeString();
		expect(await Bun.file(launchScriptPath ?? "").text()).toContain("sleep 60");
		expect(runner.calls.some((c) => c[0] === "--session" && c[3] === "new-pane")).toBe(false);
	});

	it("passes child reporting environment via a temp env file outside KDL and argv", async () => {
		await panes.spawnPane({
			task_id: "t_env",
			command: "sleep 60",
			cwd: "/tmp",
			env: {
				CUEKIT_TASK_ID: "t_env",
				CUEKIT_CHILD_TOKEN: "raw-token",
			},
		});
		const wrapped = runner.lastLayout();
		expect(wrapped).toContain('pane command="sh" cwd="/tmp" close_on_exit=true');
		expect(wrapped).not.toContain("raw-token");
		const launchScriptPath = wrapped.match(/"([^"]+launch\.sh)"/)?.[1];
		expect(await Bun.file(launchScriptPath ?? "").text()).not.toContain("raw-token");
		expect(await Bun.file(launchScriptPath ?? "").text()).toContain("sleep 60");
		const envScriptPath = (await Bun.file(launchScriptPath ?? "").text()).match(
			/\. (.+env\.sh)/,
		)?.[1];
		expect(await Bun.file(envScriptPath ?? "").text()).toContain("CUEKIT_CHILD_TOKEN=raw-token");
	});

	it("mirrors task output to transcriptPath when provided", async () => {
		await panes.spawnPane({
			task_id: "t_log",
			command: "echo hello",
			cwd: "/tmp",
			transcriptPath: "/tmp/cuekit task transcript.txt",
		});

		const wrapped = runner.lastLayout();
		expect(wrapped).toContain('pane command="script" cwd="/tmp" close_on_exit=true');
		expect(wrapped).toContain('args "-q" "/tmp/cuekit task transcript.txt" "sh"');
		const launchScriptPath = wrapped.match(/"([^"]+launch\.sh)"/)?.[1];
		expect(launchScriptPath).toBeString();
		expect(await Bun.file(launchScriptPath ?? "").text()).toContain("echo hello");
	});

	it("preserves native zellij TTY for interactive tasks even with a transcript path", async () => {
		await panes.spawnPane({
			task_id: "t_interactive",
			command: "pi prompt",
			cwd: "/tmp",
			transcriptPath: "/tmp/cuekit task transcript.txt",
			preserveNativeTty: true,
		});

		const wrapped = runner.lastLayout();
		expect(wrapped).toContain('pane command="sh" cwd="/tmp" close_on_exit=true');
		expect(wrapped).not.toContain('pane command="script"');
		expect(wrapped).not.toContain('"script" "-q"');
	});

	it("rejects invalid environment variable names", async () => {
		await expect(
			panes.spawnPane({
				task_id: "t_bad",
				command: "x",
				cwd: "/tmp",
				env: { "BAD-NAME": "x" },
			}),
		).rejects.toThrow(/invalid zellij environment key/);
	});

	it("surfaces create-background layout failures", async () => {
		runner.queueResponse({ stdout: "", stderr: "boom", exitCode: 1 });

		await expect(
			panes.spawnPane({
				task_id: "t_fail",
				command: "x",
				cwd: "/tmp",
			}),
		).rejects.toThrow(/zellij attach --create-background.*failed/);
	});

	it("uses zellij 0.44 pane-targeted shared sessions for team members", async () => {
		const first = await panes.spawnPane({
			task_id: "t_coord",
			team_id: "tm_abc123",
			team_position: "coordinator",
			command: "coord",
			cwd: "/repo",
		});
		const second = await panes.spawnPane({
			task_id: "t_worker",
			team_id: "tm_abc123",
			team_position: "worker",
			command: "worker",
			cwd: "/repo",
		});

		expect(first.backend_session).toBe("ctm-abc123");
		expect(first.backend_pane_id).toBe("ctm-abc123/terminal_0");
		expect(second.backend_session).toBe("ctm-abc123");
		expect(second.backend_pane_id).toBe("ctm-abc123/terminal_1");
		expect(runner.calls.some((c) => c[0] === "--version")).toBe(true);
		expect(runner.calls.some((c) => c[0] === "--session" && c[3] === "new-pane")).toBe(true);

		await panes.sendKeys("t_worker", "hello team");
		const writes = runner.calls.filter(
			(c) => c[0] === "--session" && (c[3] === "write-chars" || c[3] === "write"),
		);
		expect(writes.at(-2)).toEqual([
			"--session",
			"ctm-abc123",
			"action",
			"write-chars",
			"-p",
			"terminal_1",
			"hello team",
		]);
		expect(writes.at(-1)).toEqual([
			"--session",
			"ctm-abc123",
			"action",
			"write",
			"-p",
			"terminal_1",
			"13",
		]);
	});

	it("serializes concurrent first team member spawns into one session create", async () => {
		const [first, second] = await Promise.all([
			panes.spawnPane({ task_id: "t_a", team_id: "tm_parallel", command: "a", cwd: "/repo" }),
			panes.spawnPane({ task_id: "t_b", team_id: "tm_parallel", command: "b", cwd: "/repo" }),
		]);

		expect(first.backend_session).toBe("ctm-parallel");
		expect(second.backend_session).toBe("ctm-parallel");
		expect(runner.calls.filter((c) => c[0] === "attach" && c[2] === "ctm-parallel")).toHaveLength(
			1,
		);
		expect(
			runner.calls.filter(
				(c) => c[0] === "--session" && c[1] === "ctm-parallel" && c[3] === "new-pane",
			),
		).toHaveLength(1);
	});

	it("rejects team sessions when zellij is older than 0.44.2", async () => {
		runner.queueResponse({ stdout: "zellij 0.43.1\n", stderr: "", exitCode: 0 });

		await expect(
			panes.spawnPane({
				task_id: "t_old",
				team_id: "tm_old",
				command: "x",
				cwd: "/tmp",
			}),
		).rejects.toThrow(/zellij >= 0\.44\.2/);
	});
});

describe("isAlive", () => {
	it("returns true when list-sessions includes the session", async () => {
		await panes.spawnPane({ task_id: "t_alive", command: "x", cwd: "/tmp" });
		expect(await panes.isAlive("t_alive")).toBe(true);
	});

	it("returns false for a missing session", async () => {
		expect(await panes.isAlive("t_nope")).toBe(false);
	});

	it("returns false for an exited zellij session", async () => {
		runner.queueResponse({
			stdout:
				"\u001b[32;1mct-t_done\u001b[m [Created 1s ago] (\u001b[31;1mEXITED\u001b[m - attach to resurrect)",
			stderr: "",
			exitCode: 0,
		});

		expect(await panes.isAlive("t_done")).toBe(false);
	});

	it("returns false for a closed team pane even while the shared session remains", async () => {
		await panes.spawnPane({ task_id: "t_one", team_id: "tm_alive", command: "one", cwd: "/tmp" });
		await panes.spawnPane({ task_id: "t_two", team_id: "tm_alive", command: "two", cwd: "/tmp" });

		runner.closePane("ctm-alive", 1);

		expect(await panes.isAlive("t_one")).toBe(true);
		expect(await panes.isAlive("t_two")).toBe(false);
	});
});

describe("sendKeys", () => {
	it("issues write-chars then write 13 (Enter) targeting the session focused pane", async () => {
		await panes.spawnPane({
			task_id: "t_steer",
			command: "x",
			cwd: "/tmp",
		});
		await panes.sendKeys("t_steer", "hello world");

		const writes = runner.calls.filter(
			(c) => c[0] === "--session" && (c[3] === "write-chars" || c[3] === "write"),
		);
		expect(writes).toHaveLength(2);
		expect(writes[0]).toEqual(["--session", "ct-t_steer", "action", "write-chars", "hello world"]);
		expect(writes[1]).toEqual(["--session", "ct-t_steer", "action", "write", "13"]);
	});
});

describe("capturePane", () => {
	it("calls dump-screen with --full and the temp path positional, then reads the file", async () => {
		await panes.spawnPane({ task_id: "t_cap", command: "x", cwd: "/tmp" });
		const captured = await panes.capturePane("t_cap");
		expect(captured).toBe("fake screen output\n");

		const dump = runner.calls.find((c) => c[0] === "--session" && c[3] === "dump-screen");
		expect(dump).toBeDefined();
		expect(dump).toContain("--full");
		// Path is the last argument (positional, not flag-paired).
		const lastArg = dump?.at(-1) ?? "";
		expect(lastArg).toMatch(/cuekit-zellij-.*\/dump\.txt$/);
	});

	it("dumps a team pane by pane id using the zellij 0.44 --path form", async () => {
		await panes.spawnPane({ task_id: "t_team_cap", team_id: "tm_cap", command: "x", cwd: "/tmp" });
		const captured = await panes.capturePane("t_team_cap");
		expect(captured).toBe("fake screen output\n");

		const dump = runner.calls.find((c) => c[0] === "--session" && c[3] === "dump-screen");
		expect(dump).toContain("-p");
		expect(dump).toContain("terminal_0");
		expect(dump).toContain("--path");
	});
});

describe("killPane", () => {
	it("issues kill-session (singular) and removes the session from the simulator", async () => {
		await panes.spawnPane({ task_id: "t_kill", command: "x", cwd: "/tmp" });
		expect(runner.knownSessions()).toContain("ct-t_kill");

		await panes.killPane("t_kill");
		expect(runner.knownSessions()).not.toContain("ct-t_kill");
	});

	it("treats 'no such session' as idempotent success", async () => {
		runner.queueResponse({ stdout: "", stderr: "no such session: x", exitCode: 1 });
		await expect(panes.killPane("t_already_gone")).resolves.toBeUndefined();
	});

	it("falls back to delete-session for exited sessions", async () => {
		runner.queueResponse({ stdout: "", stderr: "No session named ct-t_done found", exitCode: 1 });
		runner.queueResponse({ stdout: "", stderr: "", exitCode: 0 });

		await panes.killPane("t_done");

		expect(runner.calls.at(-1)).toEqual(["delete-session", "ct-t_done"]);
	});
});

describe("team terminal and cleanup hooks", () => {
	it("renames a team pane with the terminal status", async () => {
		await panes.spawnPane({
			task_id: "t_done",
			team_id: "tm_done",
			team_position: "worker",
			command: "x",
			cwd: "/tmp",
		});

		await panes.markPaneTerminal("t_done", "completed");

		expect(runner.calls.at(-1)).toEqual([
			"--session",
			"ctm-done",
			"action",
			"rename-pane",
			"-p",
			"terminal_0",
			"worker:t_done [completed]",
		]);
	});

	it("kills compact team sessions by team id", async () => {
		await panes.spawnPane({
			task_id: "t_cleanup",
			team_id: "tm_cleanup",
			command: "x",
			cwd: "/tmp",
		});

		await panes.killTeamSession("tm_cleanup");

		expect(runner.knownSessions()).not.toContain("ctm-cleanup");
		expect(runner.calls.at(-1)).toEqual(["kill-session", "ctm-cleanup"]);
	});
});
