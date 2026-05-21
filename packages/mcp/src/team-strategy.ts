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
		"Use cuekit tools to coordinate: inspect the strategy's recommended team skeleton when useful, review and adjust it before submit_team_tasks, wait with follow_new_tasks, steer when needed, get_team_result, and report a final completed event. Cuekit will not auto-submit worker/reviewer tasks from the skeleton.",
		"Report progress after submitting tasks, bounded waits, and steering so the parent can see the current state and avoid appearing idle while work is still in progress.",
		"When submitting team tasks, set a clear position whenever the lifecycle lane is known: worker for implementation/investigation, reviewer for review, finisher for PR/release/cleanup finishing, observer for monitoring, and coordinator only for orchestration. Unpositioned team tasks are allowed for ambiguous ad-hoc work, but they will not appear in worker/reviewer/finisher lanes.",
		"## Coordinator wait loop recipe\n\nYou must stay active until all non-coordinator tasks are terminal. Use this pattern:\n\n1. submit_team_tasks for workers (position: worker)\n2. loop { wait_team(follow_new_tasks, timeout_ms: 60000) }\n   - if all workers terminal → submit reviewer (position: reviewer) or finisher\n   - if blocked/stalled → steer affected task or report blocked\n   - if attention_items include coordinator blocked → report immediately\n3. After reviewer/finisher completes → get_team_result and emit final completed report\n4. Never exit while non-coordinator tasks are running without explicit parent direction",
		"When steering team tasks via steer (kind=team, team_position, or team_tasks), the receiving task automatically sees recent team blackboard events (handoffs, decisions, findings, notes) alongside your steering message. Use blackboard_event_types to filter and blackboard_limit (default 5) to bound the count; pass include_blackboard: false only when you need a quiet steer without context.",
		"When team status or result includes attention_items, inspect them before deciding whether to continue, submit more tasks, steer a task, or emit your final report.",
		"Do not emit your final completed report while submitted worker, reviewer, or finisher tasks are still non-terminal. Wait with follow_new_tasks, inspect get_team_result, and steer idle tasks once before deciding they are unusable. If you intentionally skip, cancel, or cannot wait for any submitted non-coordinator task, explain that exception in the final report.",
		"After a `position: finisher` task completes and all submitted non-coordinator tasks are terminal or explicitly accounted for, inspect the team result with get_team_result and emit your own final completed report — do not wait for parent steering. If no finisher was submitted, the coordinator remains responsible for the final durable report under the same condition.",
	];
	return sections.filter((section): section is string => section !== undefined).join("\n\n");
}
