import { loadProjectConfig, type TeamStrategy, TeamStrategySchema } from "@cuekit/project-config";
import { z } from "incur";
import type { CommandContext } from "../command-context.ts";
import { renderTeamStrategyPrompt, resolveTeamStrategy } from "../team-strategy.ts";

export const ListStrategiesInputSchema = z.object({
	cwd: z.string().min(1).optional(),
	strategy: z.string().min(1).optional(),
	include_prompt: z.boolean().optional(),
	objective: z.string().min(1).optional(),
});
export type ListStrategiesInput = z.infer<typeof ListStrategiesInputSchema>;

const StrategySummarySchema = z.object({
	name: z.string(),
	description: z.string().optional(),
	intent: z.string().optional(),
	checks: z.array(z.string()).optional(),
});

const StrategyDetailSchema = StrategySummarySchema.extend({
	strategy: TeamStrategySchema,
	rendered_prompt: z.string().optional(),
});

export const ListStrategiesOutputSchema = z.union([
	z.object({ strategies: z.array(StrategySummarySchema) }),
	z.object({ strategy: StrategyDetailSchema }),
	z.object({
		error: z.object({
			code: z.enum(["invalid_input", "invalid_project_config", "strategy_not_found"]),
			message: z.string(),
		}),
	}),
]);
export type ListStrategiesOutput = z.infer<typeof ListStrategiesOutputSchema>;

function strategySummary(name: string, strategy: TeamStrategy) {
	return {
		name,
		...(strategy.description ? { description: strategy.description } : {}),
		...(strategy.intent ? { intent: strategy.intent } : {}),
		...(strategy.checks ? { checks: strategy.checks } : {}),
	};
}

export function runListStrategies(
	_ctx: CommandContext,
	input: ListStrategiesInput,
): ListStrategiesOutput {
	if (!input.strategy && (input.include_prompt || input.objective)) {
		return {
			error: {
				code: "invalid_input",
				message: "strategy is required when include_prompt or objective is provided",
			},
		};
	}

	const loaded = loadProjectConfig(input.cwd ?? process.cwd());
	if (!loaded.ok) {
		return { error: { code: "invalid_project_config", message: loaded.error } };
	}

	if (input.strategy) {
		const resolved = resolveTeamStrategy(loaded.config, input.strategy);
		if (!resolved.ok) return { error: resolved.error };
		return {
			strategy: {
				...strategySummary(resolved.strategy_name, resolved.strategy),
				strategy: resolved.strategy,
				...(input.include_prompt
					? {
							rendered_prompt: renderTeamStrategyPrompt({
								strategy_name: resolved.strategy_name,
								strategy: resolved.strategy,
								objective: input.objective ?? "Review this strategy and coordinate the team.",
							}),
						}
					: {}),
			},
		};
	}

	const strategies = Object.entries(loaded.config.strategies ?? {})
		.toSorted(([a], [b]) => a.localeCompare(b))
		.map(([name, strategy]) => strategySummary(name, strategy));
	return { strategies };
}
