import { listTaskEvents } from "@cuekit/store";
import type { CommandContext } from "./command-context.ts";

export function terminalReportSummary(ctx: CommandContext, taskId: string): string | undefined {
	return (
		listTaskEvents(ctx.db, taskId)
			.filter(
				(event) =>
					(event.type === "completed" || event.type === "failed" || event.type === "blocked") &&
					event.message,
			)
			.at(-1)?.message ?? undefined
	);
}

export function withTerminalReportSummaryFallback<T extends { summary: string; task_id: string }>(
	ctx: CommandContext,
	result: T,
): T {
	const summary = result.summary || terminalReportSummary(ctx, result.task_id);
	return summary ? { ...result, summary } : result;
}
