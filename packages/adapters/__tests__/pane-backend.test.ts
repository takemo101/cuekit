import { beforeEach, describe, expect, it } from "bun:test";
import { PaneBackend } from "../src/pane-backend.ts";
import { FakeTmuxRunner } from "./fake-tmux-runner.ts";

let runner: FakeTmuxRunner;
let panes: PaneBackend;
beforeEach(() => {
	runner = new FakeTmuxRunner();
	panes = new PaneBackend({ runner, sendKeysDelayMs: 0 });
});

describe("sessionNameFor / computeAttachHint", () => {
	it("builds the flat 'cuekit-task-{id}' name", () => {
		expect(panes.sessionNameFor("t_abc")).toBe("cuekit-task-t_abc");
	});

	it("returns a one-line tmux attach-session command", () => {
		expect(panes.computeAttachHint("t_abc")).toBe("tmux attach-session -t cuekit-task-t_abc");
	});
});

describe("spawnTask", () => {
	it("calls tmux new-session with -d / -s / -c / -P / -F and the launch command", async () => {
		const handle = await panes.spawnTask({
			task_id: "t_abc",
			launchCommand: "sleep 60",
			cwd: "/tmp",
		});
		expect(handle.task_id).toBe("t_abc");
		expect(handle.tmux_session_name).toBe("cuekit-task-t_abc");
		expect(handle.pane_id).toBe("%1");
		expect(handle.attach_hint).toBe("tmux attach-session -t cuekit-task-t_abc");

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

	it("sets up pipe-pane with a shell-quoted transcript path", async () => {
		await panes.spawnTask({
			task_id: "t_abc",
			launchCommand: "sleep 60",
			cwd: "/tmp",
			transcriptPath: "/tmp/spaces in it.txt",
		});
		const pipe = runner.calls.find((c) => c[0] === "pipe-pane");
		expect(pipe).toBeDefined();
		// Last arg is the shell command — should wrap the path in single quotes
		expect(pipe?.[pipe.length - 1]).toBe("cat > '/tmp/spaces in it.txt'");
	});

	it("throws when tmux reports a non-zero exit code", async () => {
		runner.queueResponse({ stdout: "", stderr: "tmux: boom", exitCode: 1 });
		await expect(
			panes.spawnTask({ task_id: "t_abc", launchCommand: "x", cwd: "/tmp" }),
		).rejects.toThrow(/tmux new-session.*failed/);
	});

	it("throws when pane id is missing from stdout", async () => {
		runner.queueResponse({ stdout: "   \n", stderr: "", exitCode: 0 });
		await expect(
			panes.spawnTask({ task_id: "t_abc", launchCommand: "x", cwd: "/tmp" }),
		).rejects.toThrow(/did not report a pane id/);
	});
});

describe("isAlive", () => {
	it("returns true when tmux has-session succeeds", async () => {
		await panes.spawnTask({
			task_id: "t_abc",
			launchCommand: "sleep",
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
		await panes.spawnTask({
			task_id: "t_abc",
			launchCommand: "sleep",
			cwd: "/tmp",
		});
		await panes.sendKeys("t_abc", "hello world");

		const sends = runner.calls.filter((c) => c[0] === "send-keys");
		expect(sends).toHaveLength(2);
		expect(sends[0]).toEqual(["send-keys", "-t", "cuekit-task-t_abc", "-l", "hello world"]);
		expect(sends[1]).toEqual(["send-keys", "-t", "cuekit-task-t_abc", "Enter"]);
	});
});

describe("killTask", () => {
	it("issues tmux kill-session and removes the session from the simulator", async () => {
		await panes.spawnTask({
			task_id: "t_abc",
			launchCommand: "sleep",
			cwd: "/tmp",
		});
		expect(runner.knownSessions()).toContain("cuekit-task-t_abc");
		await panes.killTask("t_abc");
		expect(runner.knownSessions()).not.toContain("cuekit-task-t_abc");
	});

	it("is idempotent when the session is already gone (not an error)", async () => {
		runner.queueResponse({
			stdout: "",
			stderr: "can't find session: session not found",
			exitCode: 1,
		});
		await expect(panes.killTask("t_missing")).resolves.toBeUndefined();
	});
});
