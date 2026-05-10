import { beforeEach, describe, expect, it } from "bun:test";
import { FakeZellijRunner } from "../src/testing.ts";
import { ZellijBackend } from "../src/zellij-backend.ts";

let runner: FakeZellijRunner;
let panes: ZellijBackend;
beforeEach(() => {
	runner = new FakeZellijRunner();
	panes = new ZellijBackend({ runner, sendKeysDelayMs: 0 });
});

describe("sessionNameFor / attachCommand", () => {
	it("builds the flat 'ct-{id}' name", () => {
		expect(panes.sessionNameFor("t_abc")).toBe("ct-t_abc");
	});

	it("returns a structured zellij attach argv", () => {
		expect(panes.attachCommand("t_abc")).toEqual({
			argv: ["zellij", "attach", "ct-t_abc"],
		});
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
		expect(layout).toContain('pane command="sh" close_on_exit=true');
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
		expect(wrapped).toContain('pane command="sh" close_on_exit=true');
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
		expect(wrapped).toContain('pane command="script" close_on_exit=true');
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
		expect(wrapped).toContain('pane command="sh" close_on_exit=true');
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
