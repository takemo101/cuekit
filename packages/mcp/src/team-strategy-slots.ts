import { TeamPositionSchema } from "@cuekit/core";
import type { TeamStrategy, TeamStrategySlot } from "@cuekit/project-config";
import { z } from "incur";

export const TeamStrategyTaskSkeletonItemSchema = z.object({
	slot: z.string().min(1),
	objective: z.string().min(1),
	position: TeamPositionSchema.optional(),
	role: z.string().optional(),
	agent_kind: z.string().optional(),
	model: z.string().optional(),
	adapter_options: z.record(z.string(), z.unknown()).optional(),
	conditional: z.boolean().optional(),
	condition: z.string().optional(),
});

export const TeamStrategyTaskSkeletonSchema = z.object({
	strategy: z.string(),
	team_id: z.string().optional(),
	objective: z.string(),
	tasks: z.array(TeamStrategyTaskSkeletonItemSchema),
	notes: z.array(z.string()).optional(),
});

export type TeamStrategyTaskSkeleton = z.infer<typeof TeamStrategyTaskSkeletonSchema>;

function defaultObjective(slotName: string, slot: TeamStrategySlot, objective: string): string {
	if (slot.objective) return slot.objective;
	switch (slot.position) {
		case "worker":
			return `Implement or investigate the team objective: ${objective}`;
		case "reviewer":
			return `Review the team output for correctness, risks, and unresolved findings: ${objective}`;
		case "finisher":
			return `Verify implementation/review prerequisites, finish the requested PR/release/report-back work, and report completion: ${objective}`;
		case "observer":
			return `Observe or summarize team progress for: ${objective}`;
		default:
			return `Handle ${slotName} work for the team objective: ${objective}`;
	}
}

function isFinisherSlot(slotName: string, slot: TeamStrategySlot): boolean {
	return slot.position === "finisher" || slotName === "finisher";
}

export function buildTeamStrategyTaskSkeleton(input: {
	strategy_name: string;
	strategy: TeamStrategy;
	objective: string;
	team_id?: string;
}): TeamStrategyTaskSkeleton {
	const tasks = Object.entries(input.strategy.recommended_team ?? {})
		.filter(([slotName, slot]) => slotName !== "coordinator" && slot.position !== "coordinator")
		.toSorted(([a], [b]) => a.localeCompare(b))
		.map(([slotName, slot]) => {
			const finisher = isFinisherSlot(slotName, slot);
			return {
				slot: slotName,
				objective: defaultObjective(slotName, slot, input.objective),
				...(slot.position ? { position: slot.position } : {}),
				...(slot.role ? { role: slot.role } : {}),
				...(slot.agent ? { agent_kind: slot.agent } : {}),
				...(slot.model ? { model: slot.model } : {}),
				...(slot.adapter_options ? { adapter_options: slot.adapter_options } : {}),
				...(finisher
					? {
							conditional: true,
							condition:
								"Submit only if the parent explicitly requested PR/release/cleanup finishing or final report-back work.",
						}
					: {}),
			};
		});

	const notes = [
		"Review and adjust task objectives before calling submit_team_tasks; this skeleton is not auto-submitted.",
		...(tasks.some((task) => task.conditional)
			? ["Do not submit conditional slots unless their condition applies."]
			: []),
		...(tasks.length === 0
			? ["No non-coordinator recommended_team slots are available to materialize."]
			: []),
	];

	return {
		strategy: input.strategy_name,
		...(input.team_id ? { team_id: input.team_id } : {}),
		objective: input.objective,
		tasks,
		notes,
	};
}
