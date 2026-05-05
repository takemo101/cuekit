import { z } from "incur";
import { COORDINATOR_BATCH_MODE_WARNING, teamTaskWarnings } from "./team-task-warnings.ts";

export { COORDINATOR_BATCH_MODE_WARNING };

export type CoordinatorBatchModeWarning = typeof COORDINATOR_BATCH_MODE_WARNING;

export const CoordinatorBatchModeWarningSchema = z.object({
	code: z.literal("coordinator_batch_mode"),
	message: z.string(),
});

export function coordinatorBatchModeWarnings(input: {
	position?: string;
	adapter_options?: Record<string, unknown>;
}): CoordinatorBatchModeWarning[] | undefined {
	const warnings = teamTaskWarnings(input)?.filter(
		(warning): warning is CoordinatorBatchModeWarning => warning.code === "coordinator_batch_mode",
	);
	return warnings && warnings.length > 0 ? warnings : undefined;
}
