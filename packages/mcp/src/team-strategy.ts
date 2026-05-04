import type { CuekitProjectConfig, TeamStrategy, TeamStrategySlot } from "@cuekit/project-config";

export type ResolveTeamStrategyResult =
	| { ok: true; strategy_name: string; strategy: TeamStrategy }
	| { ok: false; error: { code: "strategy_not_found"; message: string } };

export function resolveTeamStrategy(
	config: CuekitProjectConfig,
	name: string,
): ResolveTeamStrategyResult {
	const strategy = config.strategies?.[name];
	if (!strategy) {
		return {
			ok: false,
			error: {
				code: "strategy_not_found",
				message: `Team strategy not found: ${name}`,
			},
		};
	}
	return { ok: true, strategy_name: name, strategy };
}

function renderList(title: string, values: string[] | undefined): string | undefined {
	if (!values || values.length === 0) return undefined;
	return `${title}:\n${values.map((value) => `- ${value}`).join("\n")}`;
}

function renderSlot(name: string, slot: TeamStrategySlot): string {
	const parts = [
		slot.position ? `position ${slot.position}` : undefined,
		slot.role ? `role ${slot.role}` : undefined,
		slot.agent ? `agent ${slot.agent}` : undefined,
		slot.model ? `model ${slot.model}` : undefined,
		slot.objective ? `objective ${slot.objective}` : undefined,
	].filter((part): part is string => part !== undefined);
	return `- ${name}${parts.length > 0 ? `: ${parts.join(", ")}` : ""}`;
}

function renderRecommendedTeam(strategy: TeamStrategy): string | undefined {
	const team = strategy.recommended_team;
	if (!team || Object.keys(team).length === 0) return undefined;
	const slots = Object.entries(team)
		.toSorted(([a], [b]) => a.localeCompare(b))
		.map(([name, slot]) => renderSlot(name, slot));
	return `Recommended team:\n${slots.join("\n")}`;
}

function renderAutonomy(strategy: TeamStrategy): string | undefined {
	const autonomy = strategy.autonomy;
	if (!autonomy) return undefined;
	const lines: string[] = [];
	if (autonomy.allow_additional_workers !== undefined) {
		lines.push(
			autonomy.allow_additional_workers
				? "You may add additional workers when useful."
				: "Do not add additional workers unless the parent explicitly asks.",
		);
	}
	if (autonomy.allow_parallel_reviewers !== undefined) {
		lines.push(
			autonomy.allow_parallel_reviewers
				? "You may use parallel reviewers when useful."
				: "Do not use parallel reviewers unless clearly necessary.",
		);
	}
	if (autonomy.require_reviewer !== undefined) {
		lines.push(
			autonomy.require_reviewer
				? "Reviewer is required before final completion."
				: "Reviewer is recommended but not required by this strategy.",
		);
	}
	if (autonomy.allow_skip_checks !== undefined) {
		lines.push(
			autonomy.allow_skip_checks
				? "You may skip checks with a clear reason in the final report."
				: "Do not skip checks unless blocked; report any skipped check clearly.",
		);
	}
	return lines.length > 0 ? `Autonomy:\n${lines.map((line) => `- ${line}`).join("\n")}` : undefined;
}

export function renderTeamStrategyPrompt(input: {
	strategy_name: string;
	strategy: TeamStrategy;
	objective: string;
}): string {
	const sections = [
		`Team strategy: ${input.strategy_name}`,
		`Objective:\n${input.objective}`,
		input.strategy.intent ? `Intent:\n${input.strategy.intent}` : undefined,
		renderRecommendedTeam(input.strategy),
		renderList("Guardrails", input.strategy.guardrails),
		renderList("Success criteria", input.strategy.success_criteria),
		renderList("Checks", input.strategy.checks),
		renderAutonomy(input.strategy),
		"Use cuekit tools to coordinate: submit_team_tasks, wait with follow_new_tasks, steer when needed, get_team_result, and report a final completed event.",
	];
	return sections.filter((section): section is string => section !== undefined).join("\n\n");
}
