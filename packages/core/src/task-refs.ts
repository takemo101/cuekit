import { z } from "zod";

export const TaskRefsSchema = z.object({
	result_ref: z.string().optional(),
	transcript_ref: z.string().optional(),
});

export type TaskRefs = z.infer<typeof TaskRefsSchema>;
