import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, it } from "bun:test";
import { createSession, getTaskById, runMigrations } from "@cuekit/store";
import type { AgentAdapter } from "../src/agent-adapter.ts";
import { createClaudeCodeAdapter } from "../src/claude-code-adapter.ts";
import { createOpenCodeAdapter } from "../src/opencode-adapter.ts";
import { PaneBackend } from "../src/pane-backend.ts";
import { createPiAdapter } from "../src/pi-adapter.ts";
import { FakeTmuxRunner } from "../src/testing.ts";

// Shared contract suite. Every pane-backed adapter (`claude-code`,
// `pi`, `opencode`) must satisfy the same submit → status → cancel
// → collect contract because they all compose `createPaneAdapter`
// underneath. Without this, only claude-code had thorough lifecycle
// coverage (Oracle P2-8); pi and opencode had capability-declaration
// + happy-path-submit only, so an adapter-specific divergence in
// the factory composition (a wiring mistake in pi's adapter, say)
// would slip past CI until production dogfood.

interface AdapterCase {
	kind: string;
	make: (db: Database, panes: PaneBackend) => AgentAdapter;
	objective: string;
}

const CASES: AdapterCase[] = [
	{
		kind: "claude-code",
		make: (db, panes) =>
			createClaudeCodeAdapter(db, panes, {
				launchCommandOverride: () => "sleep 60",
			}),
		objective: "claude-code lifecycle",
	},
	{
		kind: "pi",
		make: (db, panes) =>
			createPiAdapter(db, panes, {
				launchCommandOverride: () => "sleep 60",
			}),
		objective: "pi lifecycle",
	},
	{
		kind: "opencode",
		make: (db, panes) =>
			createOpenCodeAdapter(db, panes, {
				launchCommandOverride: () => "sleep 60",
			}),
		objective: "opencode lifecycle",
	},
];

describe.each(CASES)("AgentAdapter contract — $kind", (testCase) => {
	let db: Database;
	let runner: FakeTmuxRunner;
	let panes: PaneBackend;
	let adapter: AgentAdapter;

	beforeEach(() => {
		db = new Database(":memory:");
		db.exec("pragma foreign_keys = ON;");
		runMigrations(db);
		createSession(db, {
			id: "s1",
			project_root: "/p",
			worktree_path: "/w",
			parent_agent_kind: testCase.kind,
		});
		runner = new FakeTmuxRunner();
		panes = new PaneBackend({ runner, sendKeysDelayMs: 0 });
		adapter = testCase.make(db, panes);
	});

	it("kind() matches capabilities().agent_kind and advertises run modes", () => {
		expect(adapter.kind).toBe(testCase.kind);
		expect(adapter.capabilities().agent_kind).toBe(testCase.kind);
		expect(adapter.capabilities().default_mode).toBe("interactive");
		expect(adapter.capabilities().supported_modes).toEqual(["interactive"]);
	});

	it("submit returns AdapterResult — accepted task with task_id", async () => {
		const result = await adapter.submit({
			spec: { agent_kind: testCase.kind, objective: testCase.objective },
			session_id: "s1",
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.task_id).toMatch(/^t_/);
	});

	it("submit rejects a mismatched spec.agent_kind with invalid_input", async () => {
		const result = await adapter.submit({
			spec: { agent_kind: "definitely-not-this-adapter", objective: "x" },
			session_id: "s1",
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("invalid_input");
		}
	});

	it("submit rejects an unknown session_id with session_not_found", async () => {
		const result = await adapter.submit({
			spec: { agent_kind: testCase.kind, objective: "x" },
			session_id: "s_missing",
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("session_not_found");
		}
	});

	it("status returns a running view with attach_hint while pane is alive", async () => {
		const result = await adapter.submit({
			spec: { agent_kind: testCase.kind, objective: "x" },
			session_id: "s1",
		});
		if (!result.ok) throw new Error(`submit failed: ${result.error.message}`);
		const view = await adapter.status(result.value.task_id);
		expect(view.agent_kind).toBe(testCase.kind);
		expect(view.status).toBe("running");
		expect(view.attach_hint).toBeDefined();
		expect(view.attach_hint).toContain(`cuekit-task-${result.value.task_id}`);
		expect(view.started_at).toBeDefined();
		expect(view.metadata?.adapter_mode).toBe("interactive");
		expect(view.metadata?.tmux_session_name).toBe(`cuekit-task-${result.value.task_id}`);
	});

	it("status reflects batch mode and disables steering", async () => {
		const result = await adapter.submit({
			spec: {
				agent_kind: testCase.kind,
				objective: "batch lifecycle",
				adapter_options: { mode: "batch" },
			},
			session_id: "s1",
		});
		if (!result.ok) throw new Error(`submit failed: ${result.error.message}`);
		const view = await adapter.status(result.value.task_id);
		expect(view.metadata?.adapter_mode).toBe("batch");
		expect(view.supports_steering).toBe(false);
		expect(view.supports_attach).toBe(true);
	});

	it("invalid adapter mode falls back to interactive", async () => {
		const result = await adapter.submit({
			spec: {
				agent_kind: testCase.kind,
				objective: "invalid mode lifecycle",
				adapter_options: { mode: "definitely-not-a-mode" },
			},
			session_id: "s1",
		});
		if (!result.ok) throw new Error(`submit failed: ${result.error.message}`);
		const view = await adapter.status(result.value.task_id);
		expect(view.metadata?.adapter_mode).toBe("interactive");
		expect(view.supports_steering).toBe(adapter.capabilities().supports_steering);
	});

	it("steer rejects batch tasks as unsupported", async () => {
		const result = await adapter.submit({
			spec: {
				agent_kind: testCase.kind,
				objective: "batch steering",
				adapter_options: { mode: "batch" },
			},
			session_id: "s1",
		});
		if (!result.ok) throw new Error(`submit failed: ${result.error.message}`);
		const ack = await adapter.steer({ task_id: result.value.task_id, message: "later" });
		expect(ack.ok).toBe(false);
		if (!ack.ok) {
			expect(ack.error.code).toBe("steering_unsupported");
		}
	});

	it("status returns task_not_found for an unknown id (genuine absence)", async () => {
		const view = await adapter.status("t_nope");
		expect(view.status).toBe("failed");
		expect(view.error?.code).toBe("task_not_found");
		// P1-4: error envelope must not fabricate timestamps.
		expect(view.created_at).toBeUndefined();
		expect(view.updated_at).toBeUndefined();
	});

	it("status returns permission_denied for a task owned by a different adapter", async () => {
		// Simulate a sibling adapter creating a task that this adapter
		// shouldn't be operating on. Use the test sibling as a generic
		// "not me" — it doesn't matter which other kind sits in the
		// row, only that ownTask() rejects cross-adapter access.
		const sibling = CASES.find((c) => c.kind !== testCase.kind);
		if (!sibling) throw new Error("setup: need at least 2 adapter cases");
		const siblingAdapter = sibling.make(db, panes);
		const sibResult = await siblingAdapter.submit({
			spec: { agent_kind: sibling.kind, objective: "owned by sibling" },
			session_id: "s1",
		});
		if (!sibResult.ok) throw new Error("sibling submit failed in setup");
		const view = await adapter.status(sibResult.value.task_id);
		expect(view.status).toBe("failed");
		expect(view.error?.code).toBe("permission_denied");
	});

	it("cancel transitions a running task to cancelled and kills its pane", async () => {
		const result = await adapter.submit({
			spec: { agent_kind: testCase.kind, objective: "x" },
			session_id: "s1",
		});
		if (!result.ok) throw new Error("submit failed");
		const ack = await adapter.cancel(result.value.task_id);
		expect(ack.ok).toBe(true);
		const row = getTaskById(db, result.value.task_id);
		expect(row?.status).toBe("cancelled");
		expect(row?.completed_at).not.toBeNull();
	});

	it("cancel returns task_not_found for an unknown id", async () => {
		const ack = await adapter.cancel("t_nope");
		expect(ack.ok).toBe(false);
	});

	it("collect on a non-terminal task returns invalid_state", async () => {
		const result = await adapter.submit({
			spec: { agent_kind: testCase.kind, objective: "x" },
			session_id: "s1",
		});
		if (!result.ok) throw new Error("submit failed");
		const col = await adapter.collect(result.value.task_id);
		expect(col.ok).toBe(false);
		if (!col.ok) {
			expect(col.error.code).toBe("invalid_state");
		}
	});

	it("collect after cancel returns a terminal TaskResult", async () => {
		const result = await adapter.submit({
			spec: { agent_kind: testCase.kind, objective: "x" },
			session_id: "s1",
		});
		if (!result.ok) throw new Error("submit failed");
		await adapter.cancel(result.value.task_id);
		const col = await adapter.collect(result.value.task_id);
		expect(col.ok).toBe(true);
		if (col.ok) {
			expect(col.value.task_id).toBe(result.value.task_id);
			expect(col.value.status).toBe("cancelled");
		}
	});

	it("list returns only this adapter's tasks (no cross-adapter leak)", async () => {
		await adapter.submit({
			spec: { agent_kind: testCase.kind, objective: "mine" },
			session_id: "s1",
		});
		// Add a sibling task to the DB via a sibling adapter.
		const sibling = CASES.find((c) => c.kind !== testCase.kind);
		if (!sibling) return;
		const siblingAdapter = sibling.make(db, panes);
		await siblingAdapter.submit({
			spec: { agent_kind: sibling.kind, objective: "theirs" },
			session_id: "s1",
		});
		const rows = await adapter.list();
		expect(rows.every((t) => t.agent_kind === testCase.kind)).toBe(true);
	});
});
