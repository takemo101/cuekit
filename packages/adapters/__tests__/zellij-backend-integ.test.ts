import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hasZellij } from "../src/testing.ts";
import { ZellijBackend } from "../src/zellij-backend.ts";

// Opt-in via CUEKIT_ZELLIJ_INTEG=1 so the default `bun test` run isn't
// destabilised by zellij background daemons interacting with bun's
// child-process tracking under parallel test execution. Also gated on
// `hasZellij()` so machines without zellij installed skip cleanly.
//
// To run: `CUEKIT_ZELLIJ_INTEG=1 bun test packages/adapters/__tests__/zellij-backend-integ.test.ts`

const enabled = process.env.CUEKIT_ZELLIJ_INTEG === "1" && hasZellij();
const suite = enabled ? describe : describe.skip;

suite("ZellijBackend (real zellij integration)", () => {
	it("runs the task command from the background-created layout", async () => {
		const panes = new ZellijBackend({ sendKeysDelayMs: 0 });
		const task_id = `i_${Math.floor(Math.random() * 1000000)}`;
		const dir = mkdtempSync(join(tmpdir(), "cuekit-zellij-integ-"));
		const marker = join(dir, "marker.txt");

		try {
			const handle = await panes.spawnPane({
				task_id,
				command: `echo zellij-layout-ok > ${marker}`,
				cwd: "/tmp",
			});
			expect(handle.backend_session).toBe(`ct-${task_id}`);
			// Synthetic pane id (zellij 0.43 doesn't print one; backend
			// fabricates `<session>/pane` so PaneHandle.backend_pane_id
			// is non-empty).
			expect(handle.backend_pane_id).toBe(`ct-${task_id}/pane`);
			expect(panes.attachCommand(task_id)?.argv).toContain(`ct-${task_id}`);

			await Bun.sleep(1000);
			expect(readFileSync(marker, "utf8")).toBe("zellij-layout-ok\n");
		} finally {
			await panes.killPane(task_id);
			rmSync(dir, { recursive: true, force: true });
		}

		// list-sessions can take a moment to reflect; allow either result.
		// The contract is "killPane succeeded without throwing", which we
		// already asserted by reaching this line.
	}, 15000);

	it("runs layout-created panes from the requested cwd", async () => {
		const panes = new ZellijBackend({ sendKeysDelayMs: 0 });
		const task_id = `cwd_${Math.floor(Math.random() * 1000000)}`;
		const dir = mkdtempSync(join(tmpdir(), "cuekit-zellij-cwd-integ-"));
		const marker = join(dir, "pwd.txt");

		try {
			await panes.spawnPane({
				task_id,
				command: "pwd > pwd.txt",
				cwd: dir,
			});

			await Bun.sleep(1000);
			expect(readFileSync(marker, "utf8").trim()).toEndWith(dir);
		} finally {
			await panes.killPane(task_id).catch(() => {});
			rmSync(dir, { recursive: true, force: true });
		}
	}, 15000);

	it("kill on a missing task is idempotent success", async () => {
		const panes = new ZellijBackend({ sendKeysDelayMs: 0 });
		const task_id = `integ_nope_${Date.now()}`;
		await expect(panes.killPane(task_id)).resolves.toBeUndefined();
	});

	it("runs and steers two team panes in one zellij 0.44 session", async () => {
		const panes = new ZellijBackend({ sendKeysDelayMs: 0 });
		const suffix = `${Math.floor(Math.random() * 1000000)}`;
		const team_id = `tm_${suffix}`;
		const firstTask = `a_${suffix}`;
		const secondTask = `b_${suffix}`;
		const dir = mkdtempSync(join(tmpdir(), "cuekit-zellij-team-integ-"));
		const firstMarker = join(dir, "first.txt");
		const secondInput = join(dir, "second.txt");

		try {
			const first = await panes.spawnPane({
				task_id: firstTask,
				team_id,
				team_position: "coordinator",
				command: `echo first-ready > ${firstMarker}; sleep 30`,
				cwd: "/tmp",
			});
			const second = await panes.spawnPane({
				task_id: secondTask,
				team_id,
				team_position: "worker",
				command: `printf 'second-ready\\n'; cat > ${secondInput}`,
				cwd: "/tmp",
			});

			expect(first.backend_session).toBe(`ctm-${suffix}`);
			expect(first.backend_pane_id).toBe(`ctm-${suffix}/terminal_0`);
			expect(second.backend_session).toBe(`ctm-${suffix}`);
			expect(second.backend_pane_id).toMatch(/^ctm-.+\/terminal_\d+$/);

			await Bun.sleep(1000);
			expect(readFileSync(firstMarker, "utf8")).toBe("first-ready\n");
			await panes.sendKeys(secondTask, "hello-team");
			await Bun.sleep(500);
			expect(readFileSync(secondInput, "utf8")).toBe("hello-team\n");
			expect(await panes.capturePane(secondTask)).toContain("second-ready");
		} finally {
			await panes.killPane(secondTask).catch(() => {});
			await panes.killPane(firstTask).catch(() => {});
			rmSync(dir, { recursive: true, force: true });
		}
	}, 20000);
});
