import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, it } from "bun:test";
import { completeTask, createSession, runMigrations, updateTaskNativeRef } from "@cuekit/store";
import { createPiAdapter } from "../src/pi-adapter.ts";
import { FakeTmuxRunner } from "../src/testing.ts";
import { TmuxBackend } from "../src/tmux-backend.ts";

describe("terminal pane attach", () => {
	let db: Database;
	let panes: TmuxBackend;

	beforeEach(() => {
		db = new Database(":memory:");
		db.exec("pragma foreign_keys = ON;");
		runMigrations(db);
		createSession(db, {
			id: "s1",
			project_root: "/p",
			worktree_path: "/w",
			parent_agent_kind: "pi",
		});
		panes = new TmuxBackend({ runner: new FakeTmuxRunner(), sendKeysDelayMs: 0 });
	});

	it("suppresses attach for terminal backend mismatch when liveness is unknown", async () => {
		const adapter = createPiAdapter(db, panes, { launchCommandOverride: () => "sleep 60" });
		const result = await adapter.submit({
			spec: { agent_kind: "pi", objective: "terminal backend mismatch" },
			session_id: "s1",
		});
		if (!result.ok) throw new Error(`submit failed: ${result.error.message}`);
		const task_id = result.value.task_id;
		updateTaskNativeRef(db, task_id, `zellij:ct-${task_id}/pane`);
		completeTask(db, { id: task_id, status: "completed", summary: "done" });

		const view = await adapter.status(task_id);

		expect(view.status).toBe("completed");
		expect(view.supports_attach).toBe(false);
		expect(view.attach_hint).toBeUndefined();
		expect(view.attach_command).toBeNull();
		expect(view.metadata?.pane_backend_mismatch).toBe(true);
	});
});
