import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, it } from "bun:test";
import { createSession, runMigrations } from "@cuekit/store";
import { createOpenCodeAdapter } from "../src/opencode-adapter.ts";
import { PaneBackend } from "../src/pane-backend.ts";
import { createPiAdapter } from "../src/pi-adapter.ts";
import { FakeTmuxRunner } from "../src/testing.ts";

let db: Database;
let panes: PaneBackend;

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
	panes = new PaneBackend({ runner: new FakeTmuxRunner(), sendKeysDelayMs: 0 });
});

describe("createPiAdapter (truthful stub)", () => {
	it("declares supports_model_selection: false (pending verified CLI shape)", () => {
		const adapter = createPiAdapter(db, panes);
		const caps = adapter.capabilities();
		expect(caps.agent_kind).toBe("pi");
		expect(caps.supports_model_selection).toBe(false);
		expect(caps.supports_attach).toBe(true);
		expect(caps.supports_steering).toBe(true);
	});

	it("rejects spec.model because supports_model_selection is false", async () => {
		const adapter = createPiAdapter(db, panes, {
			launchCommandOverride: () => "sleep 60",
		});
		const result = await adapter.submit({
			spec: { agent_kind: "pi", objective: "x", model: "anything" },
			session_id: "s1",
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("invalid_input");
		}
	});

	it("end-to-end: submit → status with attach_hint", async () => {
		const adapter = createPiAdapter(db, panes, {
			launchCommandOverride: () => "sleep 60",
		});
		const result = await adapter.submit({
			spec: { agent_kind: "pi", objective: "investigate" },
			session_id: "s1",
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const view = await adapter.status(result.value.task_id);
		expect(view.agent_kind).toBe("pi");
		expect(view.status).toBe("running");
		expect(view.attach_hint).toContain("cuekit-task-");
	});
});

describe("createOpenCodeAdapter (truthful stub)", () => {
	it("declares supports_model_selection: true without an available_models list", () => {
		const adapter = createOpenCodeAdapter(db, panes);
		const caps = adapter.capabilities();
		expect(caps.agent_kind).toBe("opencode");
		expect(caps.supports_model_selection).toBe(true);
		expect(caps.available_models).toBeUndefined();
	});

	it("accepts any model when no available_models list is published", async () => {
		const adapter = createOpenCodeAdapter(db, panes, {
			launchCommandOverride: () => "sleep 60",
		});
		// opencode's parent_agent_kind matches a session — reuse s1 though it
		// was seeded as pi; parent_agent_kind is orthogonal to target.
		const result = await adapter.submit({
			spec: {
				agent_kind: "opencode",
				objective: "x",
				model: "whatever-custom-model",
			},
			session_id: "s1",
		});
		expect(result.ok).toBe(true);
	});
});
