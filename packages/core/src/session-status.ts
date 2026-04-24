import { z } from "zod";

export const SessionStatusSchema = z.enum(["active", "completed", "failed", "cancelled"]);

export type SessionStatus = z.infer<typeof SessionStatusSchema>;
