import { describe, expect, test } from "bun:test";
import { HerdrBackend } from "../src/herdr-backend.ts";
import { parseHerdrNativeTaskRef } from "../src/herdr-coordinate.ts";
import { FakeHerdrRunner } from "../src/testing.ts";

describe("HerdrBackend", () => {
	test("spawns solo task in a cuekit-owned workspace and returns full coordinate", async () => {
		const runner = new FakeHerdrRunner();
		const backend = new HerdrBackend({ runner, sessionName: "ck-test" });
		const handle = await backend.spawnPane({
			task_id: "t_abc",
			cwd: "/repo",
			command: "echo hello",
		});
		expect(handle.backend_kind).toBe("herdr");
		expect(handle.backend_session).toBe("ck-test");
		expect(handle.backend_pane_id?.split("/")).toHaveLength(3);
		expect(
			parseHerdrNativeTaskRef(`herdr:${handle.backend_session}/${handle.backend_pane_id}`),
		).not.toBeNull();
		expect(backend.attachCommand("t_abc")).toEqual({ argv: ["herdr", "--session", "ck-test"] });
		await expect(backend.capturePane("t_abc", { scrollbackLines: 20 })).resolves.toContain(
			"echo hello",
		);
	});

	test("steers with send_input text plus Enter and closes solo workspace on kill", async () => {
		const runner = new FakeHerdrRunner();
		const backend = new HerdrBackend({ runner, sessionName: "ck-test", sendKeysDelayMs: 0 });
		await backend.spawnPane({ task_id: "t_abc", cwd: "/repo", command: "cat" });
		expect(await backend.isAlive("t_abc")).toBe(true);
		await backend.sendKeys("t_abc", "hello from parent");
		expect(await backend.capturePane("t_abc", { scrollbackLines: 20 })).toContain(
			"hello from parent",
		);
		await backend.killPane("t_abc");
		expect(await backend.isAlive("t_abc")).toBe(false);
	});

	test("restored handle validates workspace and tab before operating", async () => {
		const runner = new FakeHerdrRunner();
		const first = new HerdrBackend({ runner, sessionName: "ck-test", sendKeysDelayMs: 0 });
		const handle = await first.spawnPane({ task_id: "t_abc", cwd: "/repo", command: "cat" });

		const restored = new HerdrBackend({ runner, sessionName: "ck-test", sendKeysDelayMs: 0 });
		restored.restorePaneHandle?.(handle);
		expect(await restored.isAlive("t_abc")).toBe(true);
		await restored.sendKeys("t_abc", "restored input");
		expect(await restored.capturePane("t_abc")).toContain("restored input");

		runner.forcePaneWorkspaceMismatch(handle.backend_pane_id as string, "wrong-workspace");
		expect(await restored.isAlive("t_abc")).toBe(false);
		await expect(restored.sendKeys("t_abc", "must not land")).rejects.toThrow(
			/mismatch|not alive/i,
		);
	});

	test("team member tasks share one workspace with separate panes", async () => {
		const runner = new FakeHerdrRunner();
		const backend = new HerdrBackend({ runner, sessionName: "ck-test" });
		const coordinator = await backend.spawnPane({
			task_id: "t_coord",
			team_id: "tm_1",
			team_position: "coordinator",
			cwd: "/repo",
			command: "coord",
		});
		const worker = await backend.spawnPane({
			task_id: "t_worker",
			team_id: "tm_1",
			team_position: "worker",
			cwd: "/repo",
			command: "worker",
		});
		const [coordWorkspace] = (coordinator.backend_pane_id as string).split("/");
		const [workerWorkspace] = (worker.backend_pane_id as string).split("/");
		expect(workerWorkspace).toBe(coordWorkspace);
		expect(worker.backend_pane_id).not.toBe(coordinator.backend_pane_id);
	});

	test("restored team pane kill closes only that pane, not the whole workspace", async () => {
		const runner = new FakeHerdrRunner();
		const first = new HerdrBackend({ runner, sessionName: "ck-test" });
		const coordinator = await first.spawnPane({
			task_id: "t_coord",
			team_id: "tm_1",
			team_position: "coordinator",
			cwd: "/repo",
			command: "coord",
		});
		const worker = await first.spawnPane({
			task_id: "t_worker",
			team_id: "tm_1",
			team_position: "worker",
			cwd: "/repo",
			command: "worker",
		});

		const restored = new HerdrBackend({ runner, sessionName: "ck-test" });
		restored.restorePaneHandle?.(coordinator);
		restored.restorePaneHandle?.(worker);
		await restored.killPane("t_worker");
		expect(await restored.isAlive("t_coord")).toBe(true);
		expect(await restored.isAlive("t_worker")).toBe(false);
	});

	test("killTeamSession works after restoring team handles", async () => {
		const runner = new FakeHerdrRunner();
		const first = new HerdrBackend({ runner, sessionName: "ck-test" });
		const coordinator = await first.spawnPane({
			task_id: "t_coord",
			team_id: "tm_1",
			cwd: "/repo",
			command: "coord",
		});
		const worker = await first.spawnPane({
			task_id: "t_worker",
			team_id: "tm_1",
			cwd: "/repo",
			command: "worker",
		});

		const restored = new HerdrBackend({ runner, sessionName: "ck-test" });
		restored.restorePaneHandle?.(coordinator);
		restored.restorePaneHandle?.(worker);
		await restored.killTeamSession?.("tm_1");
		expect(await restored.isAlive("t_coord")).toBe(false);
		expect(await restored.isAlive("t_worker")).toBe(false);
	});

	test("cleans up first team workspace when command injection fails", async () => {
		const runner = new FakeHerdrRunner();
		const backend = new HerdrBackend({ runner, sessionName: "ck-test" });
		runner.failNextRunInPane();
		await expect(
			backend.spawnPane({
				task_id: "t_fail",
				team_id: "tm_fail",
				cwd: "/repo",
				command: "boom",
			}),
		).rejects.toThrow(/run_failed/);
		expect(await runner.listPanes({ session: "ck-test" })).toHaveLength(0);

		await backend.spawnPane({
			task_id: "t_retry",
			team_id: "tm_fail",
			cwd: "/repo",
			command: "retry",
		});
		expect(await backend.isAlive("t_retry")).toBe(true);
	});

	test("cleans up solo workspace when command injection fails", async () => {
		const runner = new FakeHerdrRunner();
		const backend = new HerdrBackend({ runner, sessionName: "ck-test" });
		runner.failNextRunInPane();
		await expect(
			backend.spawnPane({ task_id: "t_fail", cwd: "/repo", command: "boom" }),
		).rejects.toThrow(/run_failed/);
		expect(await runner.listPanes({ session: "ck-test" })).toHaveLength(0);
	});

	test("team cleanup closes the shared workspace", async () => {
		const runner = new FakeHerdrRunner();
		const backend = new HerdrBackend({ runner, sessionName: "ck-test" });
		await backend.spawnPane({
			task_id: "t_coord",
			team_id: "tm_1",
			cwd: "/repo",
			command: "coord",
		});
		await backend.spawnPane({
			task_id: "t_worker",
			team_id: "tm_1",
			cwd: "/repo",
			command: "worker",
		});
		await backend.killTeamSession?.("tm_1");
		expect(await backend.isAlive("t_coord")).toBe(false);
		expect(await backend.isAlive("t_worker")).toBe(false);
	});
});
