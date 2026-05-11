import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, it } from "bun:test";
import type { TaskSpec } from "@cuekit/core";
import { createSession, runMigrations } from "@cuekit/store";
import { buildGeminiLaunchCommand, createGeminiAdapter } from "../src/gemini-adapter.ts";
import { FakeTmuxRunner } from "../src/testing.ts";
import { TmuxBackend } from "../src/tmux-backend.ts";

let db: Database;
let panes: TmuxBackend;
let runner: FakeTmuxRunner;

function spec(overrides: Partial<TaskSpec> = {}): TaskSpec {
	return {
		agent_kind: "gemini",
		objective: "do the thing",
		...overrides,
	};
}

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
	runner = new FakeTmuxRunner();
	panes = new TmuxBackend({ runner, sendKeysDelayMs: 0 });
});

describe("createGeminiAdapter", () => {
	it("declares attach, steering, model selection, and both run modes", () => {
		const adapter = createGeminiAdapter(db, panes);
		const caps = adapter.capabilities();

		expect(adapter.kind).toBe("gemini");
		expect(caps.agent_kind).toBe("gemini");
		expect(caps.supports_attach).toBe(true);
		expect(caps.supports_steering).toBe(true);
		expect(caps.supports_model_selection).toBe(true);
		expect(caps.supports_artifacts).toBe(true);
		expect(caps.supports_live_progress).toBe(false);
		expect(caps.default_mode).toBe("interactive");
		expect(caps.supported_modes).toEqual(["interactive", "batch"]);
	});

	it("advertises Google's current code-targeted gemini models by default", () => {
		const adapter = createGeminiAdapter(db, panes);
		const caps = adapter.capabilities();

		expect(caps.available_models).toEqual([
			"gemini-2.5-pro",
			"gemini-2.5-flash",
			"gemini-2.5-flash-lite",
		]);
	});

	it("accepts a custom availableModels list", () => {
		const adapter = createGeminiAdapter(db, panes, {
			availableModels: ["gemini-2.5-pro"],
		});
		expect(adapter.capabilities().available_models).toEqual(["gemini-2.5-pro"]);
	});

	it("end-to-end: submit → status with attach_hint", async () => {
		const adapter = createGeminiAdapter(db, panes, {
			launchCommandOverride: () => "sleep 60",
		});

		const result = await adapter.submit({
			spec: { agent_kind: "gemini", objective: "investigate" },
			session_id: "s1",
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const view = await adapter.status(result.value.task_id);
		expect(view.agent_kind).toBe("gemini");
		expect(view.status).toBe("running");
		expect(view.attach_hint).toContain("cuekit-task-");
	});
});

describe("buildGeminiLaunchCommand", () => {
	it("defaults to interactive mode with --skip-trust and -y on the 'gemini' binary", () => {
		expect(buildGeminiLaunchCommand(spec())).toStartWith("gemini --skip-trust -y 'do the thing");
	});

	it("does NOT pass -p / --prompt by default (interactive mode preserves attach)", () => {
		const tokens = buildGeminiLaunchCommand(spec({ model: "gemini-2.5-flash" })).split(/\s+/);
		expect(tokens).not.toContain("-p");
		expect(tokens).not.toContain("--prompt");
	});

	it("respects a custom geminiBin", () => {
		expect(buildGeminiLaunchCommand(spec(), { geminiBin: "/usr/local/bin/gemini" })).toStartWith(
			"/usr/local/bin/gemini --skip-trust -y 'do the thing",
		);
	});

	it("inserts -m before the objective when a model is requested", () => {
		expect(buildGeminiLaunchCommand(spec({ model: "gemini-2.5-flash" }))).toStartWith(
			"gemini --skip-trust -y -m 'gemini-2.5-flash' 'do the thing",
		);
	});

	it("keeps --skip-trust unconditionally and -y by default", () => {
		expect(buildGeminiLaunchCommand(spec())).toStartWith("gemini --skip-trust -y 'do the thing");
		expect(
			buildGeminiLaunchCommand(
				spec({
					adapter_options: { dangerously_skip_permissions: true },
					model: "gemini-2.5-flash",
				}),
			),
		).toStartWith("gemini --skip-trust -y -m 'gemini-2.5-flash' 'do the thing");
	});

	it("omits -y but keeps --skip-trust when permissions are explicitly disabled", () => {
		const out = buildGeminiLaunchCommand(
			spec({ adapter_options: { dangerously_skip_permissions: false } }),
		);
		expect(out).toStartWith("gemini --skip-trust 'do the thing");
		const tokens = out.split(/\s+/);
		expect(tokens).not.toContain("-y");
	});

	it("shell-quotes model names with shell metacharacters", () => {
		const out = buildGeminiLaunchCommand(spec({ model: "flash; touch /tmp/pwned" }));
		expect(out).toContain("-m 'flash; touch /tmp/pwned'");
	});

	it("uses -p with the prompt as its value in batch mode", () => {
		const out = buildGeminiLaunchCommand(
			spec({ adapter_options: { mode: "batch" }, model: "gemini-2.5-flash" }),
		);
		expect(out).toStartWith("gemini --skip-trust -y -m 'gemini-2.5-flash' -p 'do the thing");
		// -p is followed by the prompt as a single quoted token, not by a
		// separate trailing positional prompt.
		expect(out).not.toMatch(/-p '[^']*' '/);
	});

	it("falls back to interactive mode for invalid mode values", () => {
		const tokens = buildGeminiLaunchCommand(
			spec({ adapter_options: { mode: "non-interactive" }, model: "gemini-2.5-flash" }),
		).split(/\s+/);
		expect(tokens).not.toContain("-p");
		expect(tokens).not.toContain("--prompt");
	});

	it("preserves the trust + permission opt-out combination in batch mode", () => {
		const out = buildGeminiLaunchCommand(
			spec({
				adapter_options: { mode: "batch", dangerously_skip_permissions: false },
			}),
		);
		expect(out).toStartWith("gemini --skip-trust -p 'do the thing");
		const tokens = out.split(/\s+/);
		expect(tokens).not.toContain("-y");
	});

	it("shell-quotes objectives with single quotes via POSIX '\\'' escape", () => {
		const out = buildGeminiLaunchCommand(spec({ objective: "it's a test" }));
		expect(out).toStartWith("gemini --skip-trust -y 'it'\\''s a test");
	});

	it("shell-quotes objectives that look like flags so they cannot be parsed as options", () => {
		const out = buildGeminiLaunchCommand(spec({ objective: "-rm -rf /" }));
		expect(out).toContain("'-rm -rf /");
		// The dash-leading objective is wrapped in single quotes, so it cannot
		// be parsed by yargs as a flag.
		expect(out).not.toMatch(/\s-rm\s/);
	});

	it("shell-quotes objectives with shell metacharacters", () => {
		const out = buildGeminiLaunchCommand(spec({ objective: "rm -rf $HOME; echo pwned" }));
		expect(out).toContain("'rm -rf $HOME; echo pwned");
	});

	for (const mode of ["default", "auto_edit", "yolo", "plan"] as const) {
		it(`emits --approval-mode '${mode}' and drops -y when approval_mode is set to ${mode}`, () => {
			const out = buildGeminiLaunchCommand(spec({ adapter_options: { approval_mode: mode } }));
			expect(out).toContain(`--approval-mode '${mode}'`);
			const tokens = out.split(/\s+/);
			expect(tokens).not.toContain("-y");
			expect(tokens).toContain("--skip-trust");
		});
	}

	it("approval_mode wins over an explicit dangerously_skip_permissions: true", () => {
		const out = buildGeminiLaunchCommand(
			spec({ adapter_options: { approval_mode: "plan", dangerously_skip_permissions: true } }),
		);
		expect(out).toContain("--approval-mode 'plan'");
		const tokens = out.split(/\s+/);
		expect(tokens).not.toContain("-y");
	});

	it("approval_mode wins over the implicit -y default", () => {
		// No dangerously_skip_permissions → defaults to true → would normally add -y.
		const out = buildGeminiLaunchCommand(spec({ adapter_options: { approval_mode: "auto_edit" } }));
		expect(out).toContain("--approval-mode 'auto_edit'");
		const tokens = out.split(/\s+/);
		expect(tokens).not.toContain("-y");
	});

	it("falls back to the binary -y path when approval_mode is invalid", () => {
		const bogusString = buildGeminiLaunchCommand(
			spec({ adapter_options: { approval_mode: "bogus" } }),
		);
		expect(bogusString).not.toContain("--approval-mode");
		expect(bogusString.split(/\s+/)).toContain("-y");

		const numeric = buildGeminiLaunchCommand(spec({ adapter_options: { approval_mode: 123 } }));
		expect(numeric).not.toContain("--approval-mode");
		expect(numeric.split(/\s+/)).toContain("-y");
	});

	it("approval_mode 'plan' combines with batch mode and model selection", () => {
		const out = buildGeminiLaunchCommand(
			spec({
				adapter_options: { approval_mode: "plan", mode: "batch" },
				model: "gemini-2.5-flash",
			}),
		);
		expect(out).toStartWith(
			"gemini --skip-trust --approval-mode 'plan' -m 'gemini-2.5-flash' -p 'do the thing",
		);
		expect(out.split(/\s+/)).not.toContain("-y");
	});
});
