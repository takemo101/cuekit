import { z } from "zod";

export const SteeringMessageSchema = z.object({
	task_id: z.string().min(1),
	message: z.string().min(1),
	reason: z.string().optional(),
	metadata: z.record(z.unknown()).optional(),
});

export type SteeringMessage = z.infer<typeof SteeringMessageSchema>;
