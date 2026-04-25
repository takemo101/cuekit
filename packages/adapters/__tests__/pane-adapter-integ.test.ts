import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { globalTaskArtifactPaths, taskArtifactPaths } from "@cuekit/core";
import { createSession, getTaskById, runMigrations } from "@cuekit/store";
import { PaneBackend } from "../src/pane-backend.ts";
import { createPiAdapter } from "../src/pi-adapter.ts";
import { hasTmux } from "../src/testing.ts";

// Dogfood-style end-to-end: real tmux + real fs + real child processes.
// Proves that the exit-code sentinel + onPaneDisappeared hook wired up in
// #39 actually reach `completed` under production conditions, not only
// against simulated pane death.
//
// Skipped when tmux isn't on PATH so minimal containers stay green.

const suite = hasTmux() ? describe : describe.skip;

// Polling helper — the launched command takes tens of ms to exit and
// have its shell flush the sentinel. Poll isAlive until the pane is
// gone or we time out.
async function waitForPaneDeath(
	panes: PaneBackend,
	task_id: string,
	timeoutMs = 5000,
): Promise<boolean> {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		if (!(await panes.isAlive(task_id))) return true;
		await Bun.sleep(50);
	}
	return false;
}

suite("pane-adapter end-to-end against real tmux (dogfood)", () => {
	let tmpCwd: string;
	let db: Database;
	let panes: PaneBackend;
	let adapter: ReturnType<typeof createPiAdapter>;

	beforeEach(() => {
		tmpCwd = mkdtempSync(join(tmpdir(), "cuekit-dogfood-"));
		db = new Database(":memory:");
		db.exec("pragma foreign_keys = ON;");
		runMigrations(db);
		createSession(db, {
			id: "s1",
			project_root: tmpCwd,
			worktree_path: tmpCwd,
			parent_agent_kind: "cuekit-cli",
		});
		panes = new PaneBackend({ sendKeysDelayMs: 0 });
		// pi is a truthful stub — using it here means the test doesn't need
		// the pi CLI or claude to be installed. We only care about the
		// pane-adapter → tmux → sentinel → status plumbing.
		adapter = createPiAdapter(db, panes, {
			launchCommandOverride: () => "true", // clean exit, code 0
		});
	});

	afterEach(async () => {
		// Best-effort cleanup in case a test aborted mid-run.
		try {
			const rows = db.prepare("select id from tasks").all() as Array<{ id: string }>;
			for (const row of rows) await panes.killTask(row.id);
		} catch {
			// ignore — panes may already be gone
		}
		db.close();
		rmSync(tmpCwd, { recursive: true, force: true });
	});

	it("submit → child exits cleanly → status infers completed from the sentinel", async () => {
		const result = await adapter.submit({
			session_id: "s1",
			spec: { agent_kind: "pi", cwd: tmpCwd, objective: "no-op" },
		});
		if (!result.ok) throw new Error(`submit failed: ${result.error.message}`);
		const task_id = result.value.task_id;

		// Wait for the `true` child + its trailing `printf ... > sentinel`
		// to finish. This is the real exit path the wrapping was built for.
		const died = await waitForPaneDeath(panes, task_id);
		expect(died).toBe(true);

		// The sentinel file should exist and say exit 0.
		const paths = taskArtifactPaths(tmpCwd, task_id);
		const sentinel = readFileSync(paths.exitCodePath, "utf8");
		expect(sentinel).toMatch(/cuekit_exit=0/);

		// status() discovers the dead pane, reads the sentinel, and
		// transitions to completed — the v0 hole that #39 closed.
		const view = await adapter.status(task_id);
		expect(view.status).toBe("completed");
		expect(view.completed_at).toBeDefined();
		expect(getTaskById(db, task_id)?.status).toBe("completed");
	});

	it("submit → child exits non-zero → status maps to failed with the exit code in the summary", async () => {
		adapter = createPiAdapter(db, panes, {
			launchCommandOverride: () => "exit 42",
		});

		const result = await adapter.submit({
			session_id: "s1",
			spec: { agent_kind: "pi", cwd: tmpCwd, objective: "forced failure" },
		});
		if (!result.ok) throw new Error(`submit failed: ${result.error.message}`);
		const task_id = result.value.task_id;

		expect(await waitForPaneDeath(panes, task_id)).toBe(true);

		const view = await adapter.status(task_id);
		expect(view.status).toBe("failed");
		expect(view.summary).toMatch(/42/);
	});

	it("read-only worktree falls back to ~/.cuekit/sentinels and still infers completed", async () => {
		// Simulates the case Oracle re-review P1-3 flagged: a worktree
		// where mkdirSync fails (read-only mount, ephemeral container,
		// hardened deno permissions). Without the global fallback,
		// every clean exit would surface as `failed` because the wrap
		// has nowhere to write its sentinel.
		const readOnlyCwd = mkdtempSync(join(tmpdir(), "cuekit-readonly-"));
		const fakeCuekitHome = mkdtempSync(join(tmpdir(), "cuekit-home-"));
		// 0o500 = read + execute, no write. mkdirSync inside the
		// worktree will EACCES.
		chmodSync(readOnlyCwd, 0o500);

		const localDb = new Database(":memory:");
		localDb.exec("pragma foreign_keys = ON;");
		runMigrations(localDb);
		createSession(localDb, {
			id: "s1",
			project_root: readOnlyCwd,
			worktree_path: readOnlyCwd,
			parent_agent_kind: "cuekit-cli",
		});
		const localPanes = new PaneBackend({ sendKeysDelayMs: 0 });
		// Pass cuekitHomeDir explicitly so the test never touches the
		// operator's real ~/.cuekit/.
		const localAdapter = createPiAdapter(localDb, localPanes, {
			launchCommandOverride: () => "true",
			cuekitHomeDir: fakeCuekitHome,
		});

		try {
			const result = await localAdapter.submit({
				session_id: "s1",
				spec: { agent_kind: "pi", cwd: readOnlyCwd, objective: "no-op" },
			});
			if (!result.ok) throw new Error(`submit failed: ${result.error.message}`);
			const task_id = result.value.task_id;

			expect(await waitForPaneDeath(localPanes, task_id)).toBe(true);

			// Sentinel must be in the global fallback dir, not the
			// (unwritable) worktree.
			const globalSentinel = globalTaskArtifactPaths(fakeCuekitHome, task_id).exitCodePath;
			expect(readFileSync(globalSentinel, "utf8")).toMatch(/cuekit_exit=0/);

			const view = await localAdapter.status(task_id);
			expect(view.status).toBe("completed");
			expect(getTaskById(localDb, task_id)?.status).toBe("completed");
		} finally {
			localDb.close();
			// Restore writable so cleanup works.
			chmodSync(readOnlyCwd, 0o700);
			rmSync(readOnlyCwd, { recursive: true, force: true });
			rmSync(fakeCuekitHome, { recursive: true, force: true });
		}
	});

	it("concurrent status() polls after pane death don't throw (race protection)", async () => {
		// Oracle re-review caught this: two pollers both see the dead
		// pane and both dispatch completeTask(completed). Pre-fix, the
		// race-loser threw a defect on the (now-allowed) self-edge in
		// validateTaskTransition. The first call should win; both should
		// resolve to the same terminal view.
		const result = await adapter.submit({
			session_id: "s1",
			spec: { agent_kind: "pi", cwd: tmpCwd, objective: "race" },
		});
		if (!result.ok) throw new Error(`submit failed: ${result.error.message}`);
		const task_id = result.value.task_id;
		expect(await waitForPaneDeath(panes, task_id)).toBe(true);

		const [a, b, c] = await Promise.all([
			adapter.status(task_id),
			adapter.status(task_id),
			adapter.status(task_id),
		]);
		expect(a.status).toBe("completed");
		expect(b.status).toBe("completed");
		expect(c.status).toBe("completed");
		// completed_at converges across all racers.
		expect(a.completed_at).toBe(b.completed_at);
		expect(b.completed_at).toBe(c.completed_at);
	});
});
