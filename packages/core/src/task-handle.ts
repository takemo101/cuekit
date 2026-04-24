import { z } from "zod";

export const TaskHandleSchema = z.object({
	task_id: z.string().min(1),
});

export type TaskHandle = z.infer<typeof TaskHandleSchema>;
