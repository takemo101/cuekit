import { z } from "incur";

export const COORDINATOR_BATCH_MODE_WARNING = {
	code: "coordinator_batch_mode",
	message:
		"Coordinator tasks are orchestration-heavy; batch mode may stall or be unsteerable. Prefer interactive mode for coordination and use batch for focused worker/reviewer tasks.",
} as const;

export type CoordinatorBatchModeWarning = typeof COORDINATOR_BATCH_MODE_WARNING;

export const CoordinatorBatchModeWarningSchema = z.object({
	code: z.literal("coordinator_batch_mode"),
	message: z.string(),
});

export function coordinatorBatchModeWarnings(input: {
	position?: string;
	adapter_options?: Record<string, unknown>;
}): CoordinatorBatchModeWarning[] | undefined {
	if (input.position !== "coordinator") return undefined;
	if (input.adapter_options?.mode !== "batch") return undefined;
	return [COORDINATOR_BATCH_MODE_WARNING];
}
