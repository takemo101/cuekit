import { describe, expect, it } from "bun:test";
import { CuekitProjectConfigSchema } from "../src/schema.ts";

describe("CuekitProjectConfigSchema", () => {
	it("accepts the recommended config shape", () => {
		const parsed = CuekitProjectConfigSchema.parse({
			project: { id: "cuekit", name: "cuekit" },
			tui: { scope: "project" },
			submit: {
				role: "worker",
				agent: "claude-code",
				model: "sonnet",
				timeout_ms: 300000,
				priority: "normal",
			},
			teams: {
				roles: {
					coordinator: "planner",
					worker: "worker",
					reviewer: "reviewer",
					observer: "scout",
				},
				cleanup: "keep-team",
				wait: { timeout_ms: 300000, poll_interval_ms: 2000 },
			},
			adapters: {
				"claude-code": { permissions: "prompt" },
				opencode: { permissions: "prompt" },
			},
		});

		expect(parsed.project?.id).toBe("cuekit");
		expect(parsed.tui?.scope).toBe("project");
		expect(parsed.submit?.agent).toBe("claude-code");
		expect(parsed.teams?.roles?.coordinator).toBe("planner");
	});

	it("allows an omitted project id", () => {
		const parsed = CuekitProjectConfigSchema.parse({ project: { name: "cuekit" } });
		expect(parsed.project?.name).toBe("cuekit");
	});

	it("rejects project-local tui.scope all", () => {
		expect(() => CuekitProjectConfigSchema.parse({ tui: { scope: "all" } })).toThrow();
	});

	it("accepts explicit project-local permission bypass", () => {
		const parsed = CuekitProjectConfigSchema.parse({
			adapters: { "claude-code": { permissions: "bypass" } },
		});

		expect(parsed.adapters?.["claude-code"]?.permissions).toBe("bypass");
	});

	it("accepts team strategy definitions", () => {
		const parsed = CuekitProjectConfigSchema.parse({
			strategies: {
				"docs-polish": {
					description: "Docs polish",
					intent: "Make a minimal docs-only improvement.",
					recommended_team: {
						coordinator: {
							position: "coordinator",
							role: "planner",
							agent: "pi",
							model: "k2p5",
						},
						worker: { position: "worker", role: "worker", agent: "pi", model: "k2p5" },
						reviewer: {
							position: "reviewer",
							role: "reviewer",
							agent: "claude-code",
							model: "sonnet",
							objective: "Review the docs-only diff.",
							adapter_options: { mode: "batch" },
						},
						finisher: {
							position: "reviewer",
							role: "pr-finisher",
							agent: "claude-code",
							model: "sonnet",
							objective: "Finish the PR flow when requested.",
						},
					},
					guardrails: ["docs-only"],
					success_criteria: ["meaning preserved"],
					checks: ["git diff --check", "bun run check"],
					autonomy: {
						allow_additional_workers: true,
						allow_parallel_reviewers: false,
						require_reviewer: true,
						allow_skip_checks: false,
					},
				},
			},
		});

		expect(parsed.strategies?.["docs-polish"]?.checks).toEqual([
			"git diff --check",
			"bun run check",
		]);
		expect(parsed.strategies?.["docs-polish"]?.recommended_team?.reviewer?.position).toBe(
			"reviewer",
		);
		expect(parsed.strategies?.["docs-polish"]?.recommended_team?.finisher?.role).toBe(
			"pr-finisher",
		);
		expect(parsed.strategies?.["docs-polish"]?.recommended_team?.finisher?.position).toBe(
			"reviewer",
		);
	});

	it("rejects legacy validation field in team strategies", () => {
		expect(() =>
			CuekitProjectConfigSchema.parse({
				strategies: { bad: { validation: ["bun test"] } },
			}),
		).toThrow();
	});

	it("rejects invalid team strategy positions", () => {
		expect(() =>
			CuekitProjectConfigSchema.parse({
				strategies: { bad: { recommended_team: { worker: { position: "manager" } } } },
			}),
		).toThrow();
	});

	it("accepts finisher position in teams.roles and strategy recommended_team", () => {
		const parsed = CuekitProjectConfigSchema.parse({
			teams: { roles: { finisher: "pr-finisher" } },
			strategies: {
				dogfood: {
					recommended_team: {
						finisher: { position: "finisher", role: "pr-finisher" },
					},
				},
			},
		});
		expect(parsed.teams?.roles?.finisher).toBe("pr-finisher");
		expect(parsed.strategies?.dogfood?.recommended_team?.finisher?.position).toBe("finisher");
	});

	it("rejects unknown top-level keys", () => {
		expect(() => CuekitProjectConfigSchema.parse({ unknown: true })).toThrow();
	});

	it("rejects invalid project ids", () => {
		expect(() => CuekitProjectConfigSchema.parse({ project: { id: "not ok" } })).toThrow();
	});

	describe("multiplexer", () => {
		it("accepts structured backend and strict settings", () => {
			expect(
				CuekitProjectConfigSchema.parse({
					multiplexer: { backend: "zellij", strict: true },
				}).multiplexer,
			).toEqual({ backend: "zellij", strict: true });
			expect(
				CuekitProjectConfigSchema.parse({
					multiplexer: { backend: "herdr", strict: true },
				}).multiplexer,
			).toEqual({ backend: "herdr", strict: true });
		});

		it("keeps accepting legacy tmux, zellij, and herdr string values", () => {
			expect(CuekitProjectConfigSchema.parse({ multiplexer: "tmux" }).multiplexer).toBe("tmux");
			expect(CuekitProjectConfigSchema.parse({ multiplexer: "zellij" }).multiplexer).toBe("zellij");
			expect(CuekitProjectConfigSchema.parse({ multiplexer: "herdr" }).multiplexer).toBe("herdr");
		});

		it("treats multiplexer as optional (default applied by buildMultiplexerBackend, not the schema)", () => {
			expect(CuekitProjectConfigSchema.parse({}).multiplexer).toBeUndefined();
		});

		it("rejects unknown multiplexer values", () => {
			expect(() => CuekitProjectConfigSchema.parse({ multiplexer: "screen" })).toThrow();
			expect(() =>
				CuekitProjectConfigSchema.parse({ multiplexer: { backend: "screen" } }),
			).toThrow();
		});

		it("requires backend for structured multiplexer config", () => {
			expect(() => CuekitProjectConfigSchema.parse({ multiplexer: { strict: true } })).toThrow();
		});

		it("keeps accepting legacy multiplexer_strict as a boolean", () => {
			expect(
				CuekitProjectConfigSchema.parse({
					multiplexer: "zellij",
					multiplexer_strict: true,
				}).multiplexer_strict,
			).toBe(true);
		});
	});

	describe("hooks", () => {
		it("accepts a single hook definition", () => {
			const parsed = CuekitProjectConfigSchema.parse({
				hooks: {
					on_task_complete: { command: "echo done", timeout: 10 },
				},
			});
			expect(parsed.hooks?.on_task_complete).toEqual({ command: "echo done", timeout: 10 });
		});

		it("accepts an array of hook definitions", () => {
			const parsed = CuekitProjectConfigSchema.parse({
				hooks: {
					on_task_complete: [
						{ command: "echo done", timeout: 10 },
						{ command: "curl webhook", timeout: 5 },
					],
				},
			});
			expect(Array.isArray(parsed.hooks?.on_task_complete)).toBe(true);
			expect((parsed.hooks?.on_task_complete as unknown[]).length).toBe(2);
		});

		it("rejects a hook without command", () => {
			expect(() =>
				CuekitProjectConfigSchema.parse({ hooks: { on_task_complete: { timeout: 10 } } }),
			).toThrow();
		});
	});
});
