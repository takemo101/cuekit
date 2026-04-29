import { JobErrorSchema } from "@cuekit/core";
import { getTaskById, listTaskEvents } from "@cuekit/store";
import { z } from "incur";
import type { CommandContext } from "../command-context.ts";

export const ListTaskEventsInputSchema = z.object({
	task_id: z.string().min(1).describe("cuekit task id."),
});

export type ListTaskEventsInput = z.infer<typeof ListTaskEventsInputSchema>;

export const ListTaskEventsOutputSchema = z.union([
	z.object({
		events: z.array(
			z.object({
				sequence: z.number().int().positive(),
				id: z.string(),
				task_id: z.string(),
				type: z.string(),
				message: z.string().nullable(),
				payload: z.unknown().nullable(),
				created_at: z.string(),
			}),
		),
	}),
	z.object({ error: JobErrorSchema }),
]);

export type ListTaskEventsOutput = z.infer<typeof ListTaskEventsOutputSchema>;

export async function runListTaskEvents(
	ctx: CommandContext,
	input: ListTaskEventsInput,
): Promise<ListTaskEventsOutput> {
	const task = getTaskById(ctx.db, input.task_id);
	if (!task) {
		return {
			error: {
				code: "task_not_found",
				message: `task '${input.task_id}' not found`,
				retryable: false,
			},
		};
	}
	return { events: listTaskEvents(ctx.db, input.task_id) };
}
