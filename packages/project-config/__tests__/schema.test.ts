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

	it("rejects unknown top-level keys", () => {
		expect(() => CuekitProjectConfigSchema.parse({ unknown: true })).toThrow();
	});

	it("rejects invalid project ids", () => {
		expect(() => CuekitProjectConfigSchema.parse({ project: { id: "not ok" } })).toThrow();
	});
});
