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
	it("builds the flat 'cuekit-task-{id}' name", () => {
		expect(panes.sessionNameFor("t_abc")).toBe("cuekit-task-t_abc");
	});

	it("returns a structured zellij attach argv", () => {
		expect(panes.attachCommand("t_abc")).toEqual({
			argv: ["zellij", "attach", "cuekit-task-t_abc"],
		});
	});
});

describe("spawnPane", () => {
	it("creates a background session, spawns a pane in it, returns a structured handle", async () => {
		const handle = await panes.spawnPane({
			task_id: "t_abc",
			command: "sleep 60",
			cwd: "/tmp",
		});
		expect(handle.task_id).toBe("t_abc");
		expect(handle.backend_kind).toBe("zellij");
		expect(handle.backend_session).toBe("cuekit-task-t_abc");
		// Synthetic pane id (0.43 has no runtime stdout pane id).
		expect(handle.backend_pane_id).toBe("cuekit-task-t_abc/pane");

		// Background-create call shape.
		const create = runner.calls.find((c) => c[0] === "attach");
		expect(create).toEqual(["attach", "--create-background", "cuekit-task-t_abc"]);

		// new-pane targets the session, uses --cwd, and ends with the user's command.
		const newPane = runner.calls.find(
			(c) => c[0] === "--session" && c[3] === "new-pane",
		);
		expect(newPane).toBeDefined();
		expect(newPane!.slice(0, 7)).toEqual([
			"--session",
			"cuekit-task-t_abc",
			"action",
			"new-pane",
			"--close-on-exit",
			"--cwd",
			"/tmp",
		]);
		expect(newPane![newPane!.length - 1]).toBe("sleep 60");
	});

	it("passes child reporting environment via env-prefix in the wrapped command", async () => {
		await panes.spawnPane({
			task_id: "t_env",
			command: "sleep 60",
			cwd: "/tmp",
			env: {
				CUEKIT_TASK_ID: "t_env",
				CUEKIT_CHILD_TOKEN: "raw-token",
			},
		});
		const newPane = runner.calls.find(
			(c) => c[0] === "--session" && c[3] === "new-pane",
		);
		expect(newPane).toBeDefined();
		const wrapped = newPane![newPane!.length - 1] ?? "";
		expect(wrapped).toContain("env CUEKIT_TASK_ID=t_env CUEKIT_CHILD_TOKEN=raw-token");
		expect(wrapped).toContain("sleep 60");
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

	it("kills the session when new-pane fails after the session was created", async () => {
		runner.queueResponse({ stdout: "", stderr: "", exitCode: 0 }); // create
		runner.queueResponse({ stdout: "", stderr: "boom", exitCode: 1 }); // new-pane

		await expect(
			panes.spawnPane({
				task_id: "t_fail",
				command: "x",
				cwd: "/tmp",
			}),
		).rejects.toThrow(/zellij action new-pane.*failed/);

		expect(
			runner.calls.some((c) => c[0] === "kill-session" && c[1] === "cuekit-task-t_fail"),
		).toBe(true);
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
		expect(writes[0]).toEqual([
			"--session",
			"cuekit-task-t_steer",
			"action",
			"write-chars",
			"hello world",
		]);
		expect(writes[1]).toEqual([
			"--session",
			"cuekit-task-t_steer",
			"action",
			"write",
			"13",
		]);
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
		const lastArg = dump![dump!.length - 1] ?? "";
		expect(lastArg).toMatch(/cuekit-zellij-.*\/dump\.txt$/);
	});
});

describe("killPane", () => {
	it("issues kill-session (singular) and removes the session from the simulator", async () => {
		await panes.spawnPane({ task_id: "t_kill", command: "x", cwd: "/tmp" });
		expect(runner.knownSessions()).toContain("cuekit-task-t_kill");

		await panes.killPane("t_kill");
		expect(runner.knownSessions()).not.toContain("cuekit-task-t_kill");
	});

	it("treats 'no such session' as idempotent success", async () => {
		runner.queueResponse({ stdout: "", stderr: "no such session: x", exitCode: 1 });
		await expect(panes.killPane("t_already_gone")).resolves.toBeUndefined();
	});
});
