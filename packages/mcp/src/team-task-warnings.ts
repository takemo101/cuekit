import { z } from "incur";

export const COORDINATOR_BATCH_MODE_WARNING = {
	code: "coordinator_batch_mode",
	message:
		"Coordinator tasks are orchestration-heavy; batch mode may stall or be unsteerable. Prefer interactive mode for coordination and use batch for focused worker/reviewer tasks.",
} as const;

export const MISSING_TEAM_POSITION_WARNING = {
	code: "missing_team_position",
	message:
		"Team task has no position; it will remain unpositioned and will not appear in coordinator/worker/reviewer/finisher/observer lanes. Set position to worker, reviewer, finisher, observer, or coordinator when the lifecycle role is known.",
} as const;

export type TeamTaskWarning =
	| typeof COORDINATOR_BATCH_MODE_WARNING
	| typeof MISSING_TEAM_POSITION_WARNING;

export const TeamTaskWarningSchema = z.union([
	z.object({
		code: z.literal("coordinator_batch_mode"),
		message: z.string(),
	}),
	z.object({
		code: z.literal("missing_team_position"),
		message: z.string(),
	}),
]);

export function teamTaskWarnings(input: {
	position?: string;
	adapter_options?: Record<string, unknown>;
}): TeamTaskWarning[] | undefined {
	const warnings: TeamTaskWarning[] = [];
	if (input.position === undefined) {
		warnings.push(MISSING_TEAM_POSITION_WARNING);
	}
	if (input.position === "coordinator" && input.adapter_options?.mode === "batch") {
		warnings.push(COORDINATOR_BATCH_MODE_WARNING);
	}
	return warnings.length > 0 ? warnings : undefined;
}
