import { z } from "zod";
import { JobErrorSchema } from "./job-error.ts";

export const AckSchema = z.discriminatedUnion("ok", [
	z.object({
		ok: z.literal(true),
		message: z.string().optional(),
	}),
	z.object({
		ok: z.literal(false),
		error: JobErrorSchema,
	}),
]);

export type Ack = z.infer<typeof AckSchema>;
