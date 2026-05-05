import { describe, expect, it } from "bun:test";
import type { TeamStrategy } from "@cuekit/project-config";
import { buildTeamStrategyTaskSkeleton } from "../src/team-strategy-slots.ts";

const strategy: TeamStrategy = {
	recommended_team: {
		coordinator: { position: "coordinator", role: "planner", agent: "pi", model: "k2p5" },
		worker: { position: "worker", role: "worker", agent: "pi", model: "k2p5" },
		reviewer: {
			position: "reviewer",
			role: "reviewer",
			agent: "claude-code",
			model: "sonnet",
			objective: "Review the implementation diff.",
			adapter_options: { mode: "batch" },
		},
		finisher: {
			position: "finisher",
			role: "pr-finisher",
			agent: "claude-code",
			model: "sonnet",
		},
	},
};

describe("buildTeamStrategyTaskSkeleton", () => {
	it("materializes non-coordinator slots into submit_team_tasks drafts", () => {
		const skeleton = buildTeamStrategyTaskSkeleton({
			strategy_name: "feature",
			strategy,
			objective: "Implement slot skeletons.",
			team_id: "tm_123",
		});

		expect(skeleton.strategy).toBe("feature");
		expect(skeleton.team_id).toBe("tm_123");
		expect(skeleton.tasks.map((task) => task.slot)).toEqual(["finisher", "reviewer", "worker"]);
		expect(skeleton.tasks.find((task) => task.slot === "worker")).toMatchObject({
			position: "worker",
			role: "worker",
			agent_kind: "pi",
			model: "k2p5",
		});
		expect(skeleton.tasks.find((task) => task.slot === "reviewer")).toMatchObject({
			objective: "Review the implementation diff.",
			adapter_options: { mode: "batch" },
		});
		expect(skeleton.tasks.some((task) => task.position === "coordinator")).toBe(false);
	});

	it("generates position-aware objectives and conditional finisher metadata", () => {
		const skeleton = buildTeamStrategyTaskSkeleton({
			strategy_name: "feature",
			strategy,
			objective: "Implement slot skeletons.",
		});

		expect(skeleton.tasks.find((task) => task.slot === "worker")?.objective).toContain(
			"Implement or investigate the team objective",
		);
		expect(skeleton.tasks.find((task) => task.slot === "finisher")).toMatchObject({
			conditional: true,
			condition: expect.stringContaining("parent explicitly requested"),
		});
		expect(skeleton.notes).toEqual(
			expect.arrayContaining([
				expect.stringContaining("Review and adjust"),
				expect.stringContaining("conditional"),
			]),
		);
	});

	it("returns an empty task list for strategies without follow-up slots", () => {
		const skeleton = buildTeamStrategyTaskSkeleton({
			strategy_name: "docs",
			strategy: { recommended_team: { coordinator: { agent: "pi" } } },
			objective: "Docs only.",
		});

		expect(skeleton.tasks).toEqual([]);
		expect(skeleton.notes).toEqual(
			expect.arrayContaining([expect.stringContaining("No non-coordinator")]),
		);
	});
});
