import { describe, expect, it } from "bun:test";
import type { CuekitProjectConfig } from "@cuekit/project-config";
import { renderTeamStrategyPrompt, resolveTeamStrategy } from "../src/team-strategy.ts";

const config: CuekitProjectConfig = {
	strategies: {
		"docs-polish": {
			description: "Docs polish",
			intent: "Make a minimal docs-only improvement.",
			recommended_team: {
				coordinator: { position: "coordinator", role: "planner", agent: "pi", model: "k2p5" },
				worker: { position: "worker", role: "worker", agent: "pi", model: "k2p5" },
				reviewer: {
					position: "reviewer",
					role: "reviewer",
					agent: "claude-code",
					model: "sonnet",
					objective: "Review the docs-only diff.",
				},
				finisher: {
					position: "finisher",
					role: "pr-finisher",
					agent: "claude-code",
					model: "sonnet",
					objective: "Finish PR flow after validation and review.",
				},
			},
			guardrails: ["Keep changes docs-only."],
			success_criteria: ["Meaning is preserved."],
			checks: ["git diff --check", "bun run check"],
			autonomy: {
				allow_additional_workers: true,
				allow_parallel_reviewers: false,
				require_reviewer: true,
				allow_skip_checks: false,
			},
		},
	},
};

describe("team strategy helpers", () => {
	it("resolves a configured team strategy", () => {
		const result = resolveTeamStrategy(config, "docs-polish");

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.strategy_name).toBe("docs-polish");
		expect(result.strategy.description).toBe("Docs polish");
	});

	it("returns a structured error for missing team strategies", () => {
		expect(resolveTeamStrategy(config, "missing")).toEqual({
			ok: false,
			error: {
				code: "strategy_not_found",
				message: "Team strategy not found: missing",
			},
		});
	});

	it("renders a coordinator mission brief from a team strategy", () => {
		const result = resolveTeamStrategy(config, "docs-polish");
		if (!result.ok) throw new Error("setup failed");

		const prompt = renderTeamStrategyPrompt({
			strategy_name: result.strategy_name,
			strategy: result.strategy,
			objective: "Polish README wait guidance.",
		});

		expect(prompt).toContain("Team strategy: docs-polish");
		expect(prompt).toContain("Objective:\nPolish README wait guidance.");
		expect(prompt).toContain("Intent:");
		expect(prompt).toContain("Recommended team:");
		expect(prompt).toContain("finisher: position finisher, role pr-finisher");
		expect(prompt).toContain("worker: position worker, role worker, agent pi, model k2p5");
		expect(prompt).toContain("Guardrails:");
		expect(prompt).toContain("Success criteria:");
		expect(prompt).toContain("Checks:");
		expect(prompt).toContain("git diff --check");
		expect(prompt).toContain("submit_team_tasks");
		expect(prompt).toContain("recommended team skeleton");
		expect(prompt).toContain("review and adjust it before submit_team_tasks");
		expect(prompt).toContain("Cuekit will not auto-submit worker/reviewer tasks");
		expect(prompt).toContain("follow_new_tasks");
		expect(prompt).toContain("When submitting team tasks, set a clear position");
		expect(prompt).toContain("worker for implementation/investigation");
		expect(prompt).toContain("Unpositioned team tasks are allowed");
		expect(prompt).toContain("attention_items");
		expect(prompt).toContain("inspect them before deciding whether to continue");
		expect(prompt).not.toContain("Validation:");
	});

	it("includes finisher post-completion guidance in coordinator prompt", () => {
		const result = resolveTeamStrategy(config, "docs-polish");
		if (!result.ok) throw new Error("setup failed");

		const prompt = renderTeamStrategyPrompt({
			strategy_name: result.strategy_name,
			strategy: result.strategy,
			objective: "Polish README wait guidance.",
		});

		expect(prompt).toContain("After a `position: finisher` task completes");
		expect(prompt).toContain("get_team_result");
		expect(prompt).toContain("do not wait for parent steering");
	});

	it("includes explicit position assignment guidance in coordinator prompt", () => {
		const result = resolveTeamStrategy(config, "docs-polish");
		if (!result.ok) throw new Error("setup failed");

		const prompt = renderTeamStrategyPrompt({
			strategy_name: result.strategy_name,
			strategy: result.strategy,
			objective: "Polish README wait guidance.",
		});

		expect(prompt).toContain("worker for implementation");
		expect(prompt).toContain("reviewer for review");
		expect(prompt).toContain("finisher for PR");
		expect(prompt).toContain("coordinator only for orchestration");
		expect(prompt).toContain("will not appear in worker/reviewer/finisher lanes");
	});
});
