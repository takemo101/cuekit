import { describe, expect, test } from "bun:test";
import { FakeHerdrRunner } from "../src/testing.ts";

describe("FakeHerdrRunner", () => {
	test("creates a workspace with root tab and pane", async () => {
		const runner = new FakeHerdrRunner();
		const workspace = await runner.createWorkspace({
			session: "ck-test",
			cwd: "/tmp/project",
			label: "task t_1",
		});
		expect(workspace.workspace_id).toMatch(/^w/);
		expect(workspace.tab_id).toContain(":1");
		expect(workspace.root_pane_id).toContain("-1");
		await expect(
			runner.getPane({ session: "ck-test", paneId: workspace.root_pane_id }),
		).resolves.toMatchObject({
			pane_id: workspace.root_pane_id,
			workspace_id: workspace.workspace_id,
			tab_id: workspace.tab_id,
		});
	});

	test("run/send/read records terminal text", async () => {
		const runner = new FakeHerdrRunner();
		const ws = await runner.createWorkspace({
			session: "ck-test",
			cwd: "/tmp/project",
			label: "task t_1",
		});
		await runner.runInPane({ session: "ck-test", paneId: ws.root_pane_id, command: "echo hi" });
		await runner.sendInput({
			session: "ck-test",
			paneId: ws.root_pane_id,
			text: "next",
			keys: ["Enter"],
		});
		const read = await runner.readPane({
			session: "ck-test",
			paneId: ws.root_pane_id,
			source: "recent",
			lines: 20,
		});
		expect(read.text).toContain("echo hi");
		expect(read.text).toContain("next");
	});

	test("compacts pane ids after close", async () => {
		const runner = new FakeHerdrRunner();
		const ws = await runner.createWorkspace({
			session: "ck-test",
			cwd: "/tmp/project",
			label: "team tm_1",
		});
		const second = await runner.splitPane({
			session: "ck-test",
			targetPaneId: ws.root_pane_id,
			direction: "right",
			cwd: "/tmp/project",
		});
		expect(second.pane_id).toMatch(/-2$/);
		await runner.closePane({ session: "ck-test", paneId: ws.root_pane_id });
		await expect(runner.getPane({ session: "ck-test", paneId: second.pane_id })).rejects.toThrow(
			/pane_not_found/,
		);
	});
});
