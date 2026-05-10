import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createSession, listTaskEvents, runMigrations } from "@cuekit/store";
import {
	buildOpenCodeLaunchCommand,
	buildOpenCodeRunLaunchCommand,
	buildOpenCodeTuiLaunchCommand,
	createOpenCodeAdapter,
} from "../src/opencode-adapter.ts";
import { PaneBackend } from "../src/tmux-backend.ts";
import { buildPiLaunchCommand, createPiAdapter } from "../src/pi-adapter.ts";
import { FakeTmuxRunner } from "../src/testing.ts";

let db: Database;
let panes: PaneBackend;
let runner: FakeTmuxRunner;

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
	panes = new PaneBackend({ runner, sendKeysDelayMs: 0 });
});

describe("createPiAdapter (truthful stub)", () => {
	it("declares supports_model_selection: true because pi exposes --model", () => {
		const adapter = createPiAdapter(db, panes);
		const caps = adapter.capabilities();
		expect(caps.agent_kind).toBe("pi");
		expect(caps.supports_model_selection).toBe(true);
		expect(caps.available_models).toBeUndefined();
		expect(caps.supports_attach).toBe(true);
		expect(caps.supports_steering).toBe(true);
		expect(caps.supports_live_progress).toBe(false);
		expect(caps.default_mode).toBe("interactive");
		expect(caps.supported_modes).toEqual(["interactive", "batch"]);
	});

	it("builds an interactive command by default", () => {
		const command = buildPiLaunchCommand({ agent_kind: "pi", objective: "investigate" });
		expect(command).toStartWith("'pi' '");
		expect(command).toContain("investigate");
		expect(command).not.toContain(" -p ");
	});

	it("adds pi-specific reporting guidance", () => {
		const command = buildPiLaunchCommand({ agent_kind: "pi", objective: "investigate" });
		expect(command).toContain("Pi adapter guidance:");
		expect(command).toContain("Do not stop after only saying the answer");
		expect(command).toContain("cuekit tool report --type completed");
	});

	it("builds a non-interactive command in batch mode", () => {
		const command = buildPiLaunchCommand({
			agent_kind: "pi",
			objective: "investigate",
			adapter_options: { mode: "batch" },
		});
		expect(command).toStartWith("'pi' -p '");
		expect(command).toContain("investigate");
	});

	it("falls back to interactive mode for invalid mode values", () => {
		const command = buildPiLaunchCommand({
			agent_kind: "pi",
			objective: "investigate",
			adapter_options: { mode: "non-interactive" },
		});
		expect(command).toStartWith("'pi' '");
		expect(command).not.toContain(" -p ");
	});

	it("shell-quotes a custom pi binary", () => {
		const command = buildPiLaunchCommand(
			{ agent_kind: "pi", objective: "investigate" },
			"custom pi",
		);
		expect(command).toStartWith("'custom pi' '");
	});

	it("passes caller-selected model to pi --model", () => {
		const command = buildPiLaunchCommand({
			agent_kind: "pi",
			objective: "investigate",
			model: "openai-codex/gpt-5.5",
		});
		expect(command).toStartWith("'pi' --model 'openai-codex/gpt-5.5' '");
		expect(command).toContain("investigate");
	});

	it("accepts spec.model because pi supports --model", async () => {
		const adapter = createPiAdapter(db, panes, {
			launchCommandOverride: () => "sleep 60",
		});
		const result = await adapter.submit({
			spec: { agent_kind: "pi", objective: "x", model: "anything" },
			session_id: "s1",
		});
		expect(result.ok).toBe(true);
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

	it("marks a running task timed_out when timeout_ms has elapsed", async () => {
		const adapter = createPiAdapter(db, panes, {
			launchCommandOverride: () => "sleep 60",
		});
		const result = await adapter.submit({
			spec: { agent_kind: "pi", objective: "investigate", timeout_ms: 1 },
			session_id: "s1",
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		await Bun.sleep(5);
		const view = await adapter.status(result.value.task_id);
		expect(view.status).toBe("timed_out");
		expect(runner.knownSessions()).not.toContain(`cuekit-task-${result.value.task_id}`);
		const events = listTaskEvents(db, result.value.task_id);
		expect(events).toHaveLength(1);
		expect(events[0]?.type).toBe("log");
		expect(events[0]?.message).toContain("task timed out after 1ms");
		expect(events[0]?.payload).toEqual({
			diagnostic: { kind: "timeout", message: "timed out after 1ms" },
		});
	});

	it("records one timeout diagnostic when concurrent status polls observe the timeout", async () => {
		const adapter = createPiAdapter(db, panes, {
			launchCommandOverride: () => "sleep 60",
		});
		const result = await adapter.submit({
			spec: { agent_kind: "pi", objective: "investigate", timeout_ms: 1 },
			session_id: "s1",
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		await Bun.sleep(5);

		const [first, second] = await Promise.all([
			adapter.status(result.value.task_id),
			adapter.status(result.value.task_id),
		]);

		expect(first.status).toBe("timed_out");
		expect(second.status).toBe("timed_out");
		const timeoutEvents = listTaskEvents(db, result.value.task_id).filter(
			(event) =>
				event.type === "log" &&
				(event.payload as { diagnostic?: { kind?: string } } | null)?.diagnostic?.kind ===
					"timeout",
		);
		expect(timeoutEvents).toHaveLength(1);
	});

	it("prefers completed sentinel over timeout when a pane already exited", async () => {
		const tmp = mkdtempSync(join(tmpdir(), "cuekit-timeout-"));
		try {
			const adapter = createPiAdapter(db, panes, {
				launchCommandOverride: () => "true",
			});
			const result = await adapter.submit({
				spec: { agent_kind: "pi", objective: "done quickly", cwd: tmp, timeout_ms: 1 },
				session_id: "s1",
			});
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			const transcript = db
				.prepare("select transcript_ref from tasks where id = ?")
				.get(result.value.task_id) as { transcript_ref: string };
			writeFileSync(join(dirname(transcript.transcript_ref), "exit-code"), "cuekit_exit=0\n");
			await panes.killPane(result.value.task_id);
			await Bun.sleep(5);
			const view = await adapter.status(result.value.task_id);
			expect(view.status).toBe("completed");
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});
});

describe("createOpenCodeAdapter (truthful stub)", () => {
	it("declares supports_model_selection: true without an available_models list", () => {
		const adapter = createOpenCodeAdapter(db, panes);
		const caps = adapter.capabilities();
		expect(caps.agent_kind).toBe("opencode");
		expect(caps.supports_model_selection).toBe(true);
		expect(caps.available_models).toBeUndefined();
		expect(caps.supports_live_progress).toBe(false);
		expect(caps.default_mode).toBe("interactive");
		expect(caps.supported_modes).toEqual(["interactive", "batch"]);
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

	it("shell-quotes caller-provided model names in the launch command", async () => {
		const adapter = createOpenCodeAdapter(db, panes);
		const result = await adapter.submit({
			spec: {
				agent_kind: "opencode",
				objective: "x",
				model: "safe; touch /tmp/pwned",
			},
			session_id: "s1",
		});
		expect(result.ok).toBe(true);
		const call = (runner.calls.find((c) => c[0] === "new-session") ?? []) as string[];
		expect(call[call.length - 1]).toContain("--model 'safe; touch /tmp/pwned'");
	});

	it("uses TUI mode with --prompt by default", () => {
		const launch = buildOpenCodeLaunchCommand({ agent_kind: "opencode", objective: "x" });
		expect(launch).toStartWith("'opencode' --prompt 'x");
		expect(launch).not.toContain("opencode' run");
		expect(launch).not.toContain("--dangerously-skip-permissions");
	});

	it("uses run mode for batch tasks", () => {
		const launch = buildOpenCodeLaunchCommand({
			agent_kind: "opencode",
			objective: "x",
			adapter_options: { mode: "batch" },
		});
		expect(launch).toStartWith("'opencode' run --dangerously-skip-permissions -- 'x");
		expect(launch).not.toContain("--prompt");
	});

	it("passes the rendered prompt as the positional run message after an option terminator", () => {
		const launch = buildOpenCodeRunLaunchCommand({ agent_kind: "opencode", objective: "x" });
		expect(launch).toStartWith("'opencode' run --dangerously-skip-permissions -- 'x");
		expect(launch).not.toContain("--prompt");
	});

	it("protects run prompts that start with option-looking text", () => {
		const launch = buildOpenCodeRunLaunchCommand({ agent_kind: "opencode", objective: "--help" });
		expect(launch).toStartWith("'opencode' run --dangerously-skip-permissions -- '--help");
	});

	it("applies permission bypass only in batch run mode", () => {
		expect(buildOpenCodeTuiLaunchCommand({ agent_kind: "opencode", objective: "x" })).not.toContain(
			"--dangerously-skip-permissions",
		);
		expect(buildOpenCodeRunLaunchCommand({ agent_kind: "opencode", objective: "x" })).toStartWith(
			"'opencode' run --dangerously-skip-permissions -- 'x",
		);
		expect(
			buildOpenCodeLaunchCommand({
				agent_kind: "opencode",
				objective: "x",
				model: "anthropic/claude",
				adapter_options: { mode: "batch", dangerously_skip_permissions: true },
			}),
		).toStartWith("'opencode' run --dangerously-skip-permissions --model 'anthropic/claude' -- 'x");
	});

	it("omits --dangerously-skip-permissions in batch when explicitly disabled", () => {
		expect(
			buildOpenCodeLaunchCommand({
				agent_kind: "opencode",
				objective: "x",
				adapter_options: { mode: "batch", dangerously_skip_permissions: false },
			}),
		).not.toContain("--dangerously-skip-permissions");
	});

	it("renders full TaskSpec guidance into the child prompt", async () => {
		const adapter = createOpenCodeAdapter(db, panes);
		const result = await adapter.submit({
			spec: {
				agent_kind: "opencode",
				objective: "fix flaky test",
				context: "The failure happens under bun test --bail.",
				constraints: ["Do not modify package.json", "Run targeted tests"],
				inputs: [{ kind: "file", ref: "packages/foo.test.ts", title: "flaky test" }],
				expected_output: { format: "summary", require_tests: true },
				adapter_options: { sandbox: "workspace-write" },
				metadata: { ticket: "CK-1" },
			},
			session_id: "s1",
		});
		expect(result.ok).toBe(true);
		const call = (runner.calls.find((c) => c[0] === "new-session") ?? []) as string[];
		const launch = call[call.length - 1] ?? "";
		expect(launch).toContain("fix flaky test");
		expect(launch).toContain("The failure happens under bun test --bail.");
		expect(launch).toContain("Do not modify package.json");
		expect(launch).toContain("packages/foo.test.ts");
		expect(launch).toContain("require_tests");
		expect(launch).not.toContain("sandbox");
		expect(launch).not.toContain("CK-1");
	});
});
