import { z } from "zod";
import { TaskStatusSchema } from "./task-status.ts";

export const TaskSnapshotEventSchema = z.object({
	sequence: z.number().int().positive(),
	id: z.string().min(1),
	task_id: z.string().min(1),
	type: z.string().min(1),
	message: z.string().nullable(),
	payload: z.unknown().nullable(),
	created_at: z.string().datetime({ offset: true }),
});

export const TaskSnapshotHandoffSchema = z.object({
	sequence: z.number().int().positive(),
	message_preview: z.string().optional(),
	artifact_path: z.string().optional(),
	created_at: z.string().datetime({ offset: true }),
});

export const TaskSnapshotSchema = z.object({
	task_id: z.string().min(1),
	status: TaskStatusSchema,
	agent_kind: z.string().min(1),
	model: z.string().min(1).optional(),
	role: z.string().min(1).optional(),
	objective: z.string().min(1).optional(),
	cwd: z.string().min(1).optional(),
	run_kind: z.string().min(1).optional(),
	long_lived: z.boolean().optional(),
	last_activity_at: z.string().datetime({ offset: true }).optional(),
	latest_events: z.array(TaskSnapshotEventSchema),
	latest_handoffs: z.array(TaskSnapshotHandoffSchema),
	transcript_tail: z.string().optional(),
	suggested_next_read_actions: z.array(z.string()),
});

export type TaskSnapshot = z.infer<typeof TaskSnapshotSchema>;
