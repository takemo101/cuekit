import { describe, expect, it } from "bun:test";
import { PaneBackend } from "../src/pane-backend.ts";
import { hasTmux } from "../src/testing.ts";

// Skipped automatically when `tmux` is not on PATH, so unit-test runs on
// minimal dev containers stay green. Exercises the real tmux binary for the
// spawn → has-session → kill-session round-trip.

const suite = hasTmux() ? describe : describe.skip;

suite("PaneBackend (real tmux integration)", () => {
	it("round-trips new-session → has-session → kill-session", async () => {
		const panes = new PaneBackend({ sendKeysDelayMs: 0 });
		const task_id = `integ_${Date.now()}_${Math.floor(Math.random() * 100000)}`;

		try {
			const handle = await panes.spawnTask({
				task_id,
				launchCommand: "sleep 30",
				cwd: "/tmp",
			});
			expect(handle.tmux_session_name).toBe(`cuekit-task-${task_id}`);
			expect(handle.pane_id).toMatch(/^%\d+$/);
			expect(handle.attach_hint).toContain(task_id);

			expect(await panes.isAlive(task_id)).toBe(true);
		} finally {
			await panes.killTask(task_id);
		}

		expect(await panes.isAlive(task_id)).toBe(false);
	});

	it("kill-session on a missing task is idempotent success", async () => {
		const panes = new PaneBackend({ sendKeysDelayMs: 0 });
		const task_id = `integ_nope_${Date.now()}`;
		await expect(panes.killTask(task_id)).resolves.toBeUndefined();
	});
});
