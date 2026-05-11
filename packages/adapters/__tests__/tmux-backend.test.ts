import { beforeEach, describe, expect, it } from "bun:test";
import { FakeTmuxRunner } from "../src/testing.ts";
import { TmuxBackend } from "../src/tmux-backend.ts";

let runner: FakeTmuxRunner;
let panes: TmuxBackend;
beforeEach(() => {
	runner = new FakeTmuxRunner();
	panes = new TmuxBackend({ runner, sendKeysDelayMs: 0 });
});

describe("sessionNameFor / attachCommand", () => {
	it("builds the flat 'cuekit-task-{id}' name", () => {
		expect(panes.sessionNameFor("t_abc")).toBe("cuekit-task-t_abc");
	});

	it("returns a structured tmux attach-session argv", () => {
		expect(panes.attachCommand("t_abc")).toEqual({
			argv: ["tmux", "attach-session", "-t", "cuekit-task-t_abc"],
		});
	});
});

describe("spawnPane", () => {
	it("calls tmux new-session with -d / -s / -c / -P / -F and the launch command", async () => {
		const handle = await panes.spawnPane({
			task_id: "t_abc",
			command: "sleep 60",
			cwd: "/tmp",
		});
		expect(handle.task_id).toBe("t_abc");
		expect(handle.backend_kind).toBe("tmux");
		expect(handle.backend_session).toBe("cuekit-task-t_abc");
		expect(handle.backend_pane_id).toBe("%1");

		const call = runner.calls[0] ?? [];
		expect(call[0]).toBe("new-session");
		expect(call).toContain("-d");
		expect(call).toContain("-s");
		expect(call).toContain("cuekit-task-t_abc");
		expect(call).toContain("-c");
		expect(call).toContain("/tmp");
		expect(call).toContain("-P");
		expect(call).toContain("-F");
		expect(call).toContain("#{pane_id}");
		expect(call[call.length - 1]).toBe("sleep 60");
	});

	it("passes child reporting environment to tmux without embedding it in the launch command", async () => {
		await panes.spawnPane({
			task_id: "t_abc",
			command: "sleep 60",
			cwd: "/tmp",
			env: {
				CUEKIT_TASK_ID: "t_abc",
				CUEKIT_CHILD_TOKEN: "raw-token",
			},
		});
		const call = runner.calls[0] ?? [];
		expect(call).toContain("-e");
		expect(call.slice(call.indexOf("-e"), call.indexOf("-c"))).toEqual([
			"-e",
			"CUEKIT_TASK_ID=t_abc",
			"-e",
			"CUEKIT_CHILD_TOKEN=raw-token",
		]);
		expect(call[call.length - 1]).toBe("sleep 60");
	});

	it("rejects invalid environment variable names", async () => {
		await expect(
			panes.spawnPane({
				task_id: "t_abc",
				command: "sleep 60",
				cwd: "/tmp",
				env: { "BAD-NAME": "x" },
			}),
		).rejects.toThrow(/invalid tmux environment key/);
	});

	it("sets up pipe-pane with a shell-quoted transcript path", async () => {
		await panes.spawnPane({
			task_id: "t_abc",
			command: "sleep 60",
			cwd: "/tmp",
			transcriptPath: "/tmp/spaces in it.txt",
		});
		const pipe = runner.calls.find((c) => c[0] === "pipe-pane");
		expect(pipe).toBeDefined();
		// Last arg is the shell command — should wrap the path in single quotes
		expect(pipe?.[pipe.length - 1]).toBe("cat > '/tmp/spaces in it.txt'");
	});

	it("kills the tmux session when pipe-pane fails after new-session succeeds", async () => {
		const calls: string[][] = [];
		const failingPipePanes = new TmuxBackend({
			runner: {
				async run(args) {
					calls.push([...args]);
					if (args[0] === "new-session") return { stdout: "%9\n", stderr: "", exitCode: 0 };
					if (args[0] === "pipe-pane") return { stdout: "", stderr: "pipe failed", exitCode: 1 };
					return { stdout: "", stderr: "", exitCode: 0 };
				},
			},
		});

		await expect(
			failingPipePanes.spawnPane({
				task_id: "t_abc",
				command: "sleep 60",
				cwd: "/tmp",
				transcriptPath: "/tmp/transcript.txt",
			}),
		).rejects.toThrow(/pipe-pane/);

		expect(calls).toContainEqual(["kill-session", "-t", "cuekit-task-t_abc"]);
	});

	it("throws when tmux reports a non-zero exit code", async () => {
		runner.queueResponse({ stdout: "", stderr: "tmux: boom", exitCode: 1 });
		await expect(panes.spawnPane({ task_id: "t_abc", command: "x", cwd: "/tmp" })).rejects.toThrow(
			/tmux new-session.*failed/,
		);
	});

	it("throws when pane id is missing from stdout", async () => {
		runner.queueResponse({ stdout: "   \n", stderr: "", exitCode: 0 });
		await expect(panes.spawnPane({ task_id: "t_abc", command: "x", cwd: "/tmp" })).rejects.toThrow(
			/did not report a pane id/,
		);
	});
});

describe("isAlive", () => {
	it("returns true when tmux has-session succeeds", async () => {
		await panes.spawnPane({
			task_id: "t_abc",
			command: "sleep",
			cwd: "/tmp",
		});
		expect(await panes.isAlive("t_abc")).toBe(true);
	});

	it("returns false when tmux has-session fails", async () => {
		expect(await panes.isAlive("t_nope")).toBe(false);
	});
});

describe("sendKeys", () => {
	it("issues two send-keys calls: literal text then Enter", async () => {
		await panes.spawnPane({
			task_id: "t_abc",
			command: "sleep",
			cwd: "/tmp",
		});
		await panes.sendKeys("t_abc", "hello world");

		const sends = runner.calls.filter((c) => c[0] === "send-keys");
		expect(sends).toHaveLength(2);
		expect(sends[0]).toEqual(["send-keys", "-t", "cuekit-task-t_abc", "-l", "hello world"]);
		expect(sends[1]).toEqual(["send-keys", "-t", "cuekit-task-t_abc", "Enter"]);
	});
});

describe("killPane", () => {
	it("issues tmux kill-session and removes the session from the simulator", async () => {
		await panes.spawnPane({
			task_id: "t_abc",
			command: "sleep",
			cwd: "/tmp",
		});
		expect(runner.knownSessions()).toContain("cuekit-task-t_abc");
		await panes.killPane("t_abc");
		expect(runner.knownSessions()).not.toContain("cuekit-task-t_abc");
	});

	it("is idempotent when the session is already gone (not an error)", async () => {
		runner.queueResponse({
			stdout: "",
			stderr: "can't find session: session not found",
			exitCode: 1,
		});
		await expect(panes.killPane("t_missing")).resolves.toBeUndefined();
	});
});
