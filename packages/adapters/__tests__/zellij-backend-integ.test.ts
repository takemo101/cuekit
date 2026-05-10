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
		const task_id = `integ_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
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

	it("kill on a missing task is idempotent success", async () => {
		const panes = new ZellijBackend({ sendKeysDelayMs: 0 });
		const task_id = `integ_nope_${Date.now()}`;
		await expect(panes.killPane(task_id)).resolves.toBeUndefined();
	});
});
