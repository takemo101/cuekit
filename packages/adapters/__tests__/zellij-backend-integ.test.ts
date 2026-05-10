import { describe, expect, it } from "bun:test";
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
	it("round-trips background-create → new-pane → isAlive → killPane", async () => {
		const panes = new ZellijBackend({ sendKeysDelayMs: 0 });
		const task_id = `integ_${Date.now()}_${Math.floor(Math.random() * 100000)}`;

		try {
			const handle = await panes.spawnPane({
				task_id,
				// Short-lived child so the bun:test runner doesn't have to
				// wait on long-running pane processes after the test
				// asserts. kill-session in finally still tears the whole
				// session down regardless.
				command: "sleep 5",
				cwd: "/tmp",
			});
			expect(handle.backend_session).toBe(`cuekit-task-${task_id}`);
			// Synthetic pane id (zellij 0.43 doesn't print one; backend
			// fabricates `<session>/pane` so PaneHandle.backend_pane_id
			// is non-empty).
			expect(handle.backend_pane_id).toBe(`cuekit-task-${task_id}/pane`);
			expect(panes.attachCommand(task_id)?.argv).toContain(`cuekit-task-${task_id}`);

			expect(await panes.isAlive(task_id)).toBe(true);

			// Capture is best-effort against a freshly-spawned pane: zellij
			// may not have rendered the first frame in the brief window
			// before this assertion runs, so we accept either null or a
			// string. The contract we exercise here is "the dump-screen
			// CLI invocation completes without throwing".
			const captured = await panes.capturePane(task_id);
			expect(captured === null || typeof captured === "string").toBe(true);
		} finally {
			await panes.killPane(task_id);
		}

		// list-sessions can take a moment to reflect; allow either result.
		// The contract is "killPane succeeded without throwing", which we
		// already asserted by reaching this line.
	});

	it("kill on a missing task is idempotent success", async () => {
		const panes = new ZellijBackend({ sendKeysDelayMs: 0 });
		const task_id = `integ_nope_${Date.now()}`;
		await expect(panes.killPane(task_id)).resolves.toBeUndefined();
	});
});
