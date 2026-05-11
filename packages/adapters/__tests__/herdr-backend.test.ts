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

	test("restored handle keeps attach command and session metadata on the persisted session", async () => {
		const runner = new FakeHerdrRunner();
		const first = new HerdrBackend({ runner, sessionName: "ck-old", sendKeysDelayMs: 0 });
		const handle = await first.spawnPane({ task_id: "t_abc", cwd: "/repo", command: "cat" });

		const restored = new HerdrBackend({ runner, sessionName: "ck-new", sendKeysDelayMs: 0 });
		restored.restorePaneHandle?.(handle);

		expect(await restored.isAlive("t_abc")).toBe(true);
		expect(restored.sessionNameFor("t_abc")).toBe("ck-old");
		expect(restored.attachCommand("t_abc")).toEqual({ argv: ["herdr", "--session", "ck-old"] });
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

	test("team positions use named tabs inside one workspace", async () => {
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
		const reviewer = await backend.spawnPane({
			task_id: "t_reviewer",
			team_id: "tm_1",
			team_position: "reviewer",
			cwd: "/repo",
			command: "reviewer",
		});
		const [coordWorkspace, coordTab] = (coordinator.backend_pane_id as string).split("/");
		const [workerWorkspace, workerTab] = (worker.backend_pane_id as string).split("/");
		const [reviewerWorkspace, reviewerTab] = (reviewer.backend_pane_id as string).split("/");
		expect(workerWorkspace).toBe(coordWorkspace);
		expect(reviewerWorkspace).toBe(coordWorkspace);
		expect(new Set([coordTab, workerTab, reviewerTab]).size).toBe(3);
		expect(runner.tabLabels("ck-test", coordWorkspace as string)).toEqual({
			[coordTab as string]: "coordinator",
			[workerTab as string]: "worker",
			[reviewerTab as string]: "reviewer",
		});
	});

	test("same team position shares an existing named tab", async () => {
		const runner = new FakeHerdrRunner();
		const backend = new HerdrBackend({ runner, sessionName: "ck-test" });
		const first = await backend.spawnPane({
			task_id: "t_worker_1",
			team_id: "tm_1",
			team_position: "worker",
			cwd: "/repo",
			command: "worker 1",
		});
		const second = await backend.spawnPane({
			task_id: "t_worker_2",
			team_id: "tm_1",
			team_position: "worker",
			cwd: "/repo",
			command: "worker 2",
		});
		const [firstWorkspace, firstTab, firstPane] = (first.backend_pane_id as string).split("/");
		const [secondWorkspace, secondTab, secondPane] = (second.backend_pane_id as string).split("/");
		expect(secondWorkspace).toBe(firstWorkspace);
		expect(secondTab).toBe(firstTab);
		expect(secondPane).not.toBe(firstPane);
		expect(runner.tabLabels("ck-test", firstWorkspace as string)).toEqual({
			[firstTab as string]: "worker",
		});
	});

	test("serializes concurrent first team member spawns into one workspace", async () => {
		const runner = new FakeHerdrRunner();
		const backend = new HerdrBackend({ runner, sessionName: "ck-test" });
		const [coordinator, worker, reviewer] = await Promise.all([
			backend.spawnPane({
				task_id: "t_coord",
				team_id: "tm_1",
				team_position: "coordinator",
				cwd: "/repo",
				command: "coord",
			}),
			backend.spawnPane({
				task_id: "t_worker",
				team_id: "tm_1",
				team_position: "worker",
				cwd: "/repo",
				command: "worker",
			}),
			backend.spawnPane({
				task_id: "t_reviewer",
				team_id: "tm_1",
				team_position: "reviewer",
				cwd: "/repo",
				command: "reviewer",
			}),
		]);
		const coordinates = [coordinator, worker, reviewer].map((handle) =>
			(handle.backend_pane_id as string).split("/"),
		);
		const workspaces = coordinates.map(([workspace]) => workspace);
		const tabs = coordinates.map(([, tab]) => tab);
		expect(new Set(workspaces).size).toBe(1);
		expect(new Set(tabs).size).toBe(3);
		expect(runner.calls.filter((call) => call.method === "createWorkspace")).toHaveLength(1);
	});

	test("recreates a position tab after the previous position pane is closed", async () => {
		const runner = new FakeHerdrRunner();
		const backend = new HerdrBackend({ runner, sessionName: "ck-test" });
		const first = await backend.spawnPane({
			task_id: "t_worker_1",
			team_id: "tm_1",
			team_position: "worker",
			cwd: "/repo",
			command: "worker 1",
		});
		await backend.spawnPane({
			task_id: "t_reviewer",
			team_id: "tm_1",
			team_position: "reviewer",
			cwd: "/repo",
			command: "reviewer",
		});
		await backend.killPane("t_worker_1");

		const second = await backend.spawnPane({
			task_id: "t_worker_2",
			team_id: "tm_1",
			team_position: "worker",
			cwd: "/repo",
			command: "worker 2",
		});
		const [firstWorkspace, firstTab] = (first.backend_pane_id as string).split("/");
		const [secondWorkspace, secondTab] = (second.backend_pane_id as string).split("/");
		expect(secondWorkspace).toBe(firstWorkspace);
		expect(secondTab).not.toBe(firstTab);
		expect(runner.tabLabels("ck-test", firstWorkspace as string)[secondTab as string]).toBe(
			"worker",
		);
	});

	test("does not close the last pane in a different tab for a removed stale tab", async () => {
		const runner = new FakeHerdrRunner();
		const backend = new HerdrBackend({ runner, sessionName: "ck-test" });
		await backend.spawnPane({
			task_id: "t_coord",
			team_id: "tm_1",
			team_position: "coordinator",
			cwd: "/repo",
			command: "coord",
		});
		const stale = await backend.spawnPane({
			task_id: "t_stale",
			team_id: "tm_1",
			team_position: "reviewer",
			cwd: "/repo",
			command: "reviewer",
		});
		const [workspaceId, staleTabId] = (stale.backend_pane_id as string).split("/");
		await runner.closeTab({ session: "ck-test", tabId: staleTabId as string });

		await backend.killPane("t_stale");

		expect(await backend.isAlive("t_coord")).toBe(true);
		expect(await runner.listPanes({ session: "ck-test", workspaceId })).toHaveLength(1);
	});

	test("kills a remaining team pane whose Herdr id was compacted after another pane closed", async () => {
		const runner = new FakeHerdrRunner();
		const backend = new HerdrBackend({ runner, sessionName: "ck-test" });
		await backend.spawnPane({
			task_id: "t_worker_1",
			team_id: "tm_1",
			team_position: "worker",
			cwd: "/repo",
			command: "worker 1",
		});
		const second = await backend.spawnPane({
			task_id: "t_worker_2",
			team_id: "tm_1",
			team_position: "worker",
			cwd: "/repo",
			command: "worker 2",
		});
		const [workspaceId] = (second.backend_pane_id as string).split("/");

		await backend.killPane("t_worker_1");
		await backend.killPane("t_worker_2");

		expect(await backend.isAlive("t_worker_2")).toBe(false);
		expect(await runner.listPanes({ session: "ck-test", workspaceId })).toEqual([]);
	});

	test("reuses a restored team workspace for later team spawns", async () => {
		const runner = new FakeHerdrRunner();
		const first = new HerdrBackend({ runner, sessionName: "ck-test" });
		const coordinator = await first.spawnPane({
			task_id: "t_coord",
			team_id: "tm_1",
			team_position: "coordinator",
			cwd: "/repo",
			command: "coord",
		});

		const restored = new HerdrBackend({ runner, sessionName: "ck-test" });
		restored.restorePaneHandle?.(coordinator);
		const worker = await restored.spawnPane({
			task_id: "t_worker",
			team_id: "tm_1",
			team_position: "worker",
			cwd: "/repo",
			command: "worker",
		});

		const [coordWorkspace] = (coordinator.backend_pane_id as string).split("/");
		const [workerWorkspace, workerTab] = (worker.backend_pane_id as string).split("/");
		expect(workerWorkspace).toBe(coordWorkspace);
		expect(runner.calls.filter((call) => call.method === "createWorkspace")).toHaveLength(1);
		expect(runner.tabLabels("ck-test", coordWorkspace as string)[workerTab as string]).toBe(
			"worker",
		);
	});

	test("restores legacy team labels as shared member panes", async () => {
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
		restored.restorePaneHandle?.({ ...coordinator, backend_label: "team:tm_1:t_coord" });
		restored.restorePaneHandle?.({ ...worker, backend_label: "team:tm_1:t_worker" });
		await restored.killPane("t_worker");

		expect(await restored.isAlive("t_coord")).toBe(true);
		expect(await restored.isAlive("t_worker")).toBe(false);
	});

	test("serializes concurrent first team member spawns into one workspace", async () => {
		const runner = new FakeHerdrRunner();
		const backend = new HerdrBackend({ runner, sessionName: "ck-test" });
		const [coordinator, worker, reviewer] = await Promise.all([
			backend.spawnPane({
				task_id: "t_coord",
				team_id: "tm_1",
				team_position: "coordinator",
				cwd: "/repo",
				command: "coord",
			}),
			backend.spawnPane({
				task_id: "t_worker",
				team_id: "tm_1",
				team_position: "worker",
				cwd: "/repo",
				command: "worker",
			}),
			backend.spawnPane({
				task_id: "t_reviewer",
				team_id: "tm_1",
				team_position: "reviewer",
				cwd: "/repo",
				command: "reviewer",
			}),
		]);
		const workspaces = [coordinator, worker, reviewer].map(
			(handle) => (handle.backend_pane_id as string).split("/")[0],
		);
		expect(new Set(workspaces).size).toBe(1);
		expect(runner.calls.filter((call) => call.method === "createWorkspace")).toHaveLength(1);
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

	test("cleans up first team workspace when initial tab rename fails", async () => {
		const runner = new FakeHerdrRunner();
		runner.failNextRenameTab();
		const backend = new HerdrBackend({ runner, sessionName: "ck-test" });

		await expect(
			backend.spawnPane({
				task_id: "t_coord",
				team_id: "tm_fail",
				team_position: "coordinator",
				cwd: "/repo",
				command: "coord",
			}),
		).rejects.toThrow(/rename_failed/);
		expect(runner.calls.some((call) => call.method === "closeWorkspace")).toBe(true);

		const retry = await backend.spawnPane({
			task_id: "t_coord_retry",
			team_id: "tm_fail",
			team_position: "coordinator",
			cwd: "/repo",
			command: "coord retry",
		});
		expect(await backend.isAlive("t_coord_retry")).toBe(true);
		expect((retry.backend_pane_id as string).split("/")[0]).toBe("w2");
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
