import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { AckSchema, type JobError } from "@cuekit/core";
import { getTaskById } from "@cuekit/store";
import { z } from "incur";
import type { CommandContext } from "../command-context.ts";

export const SteerTaskInputSchema = z
	.object({
		task_id: z.string().min(1).describe("cuekit task id."),
		message: z.string().min(1).optional().describe("Steering text to inject into the running agent."),
		message_file: z.string().min(1).optional().describe("Path to steering text to read."),
		event_type: z.enum(["handoff"]).optional(),
		reason: z.string().min(1).optional(),
		actor: z.never().optional().describe("Unsupported: put provenance in HANDOFF body."),
		source: z.never().optional().describe("Unsupported: put provenance in HANDOFF body."),
	})
	.refine((input) => (input.message ? 1 : 0) + (input.message_file ? 1 : 0) === 1, {
		message: "exactly one of message or message_file is required",
	});

export type SteerTaskInput = z.infer<typeof SteerTaskInputSchema>;

export const SteerTaskOutputSchema = AckSchema;
export type SteerTaskOutput = z.infer<typeof SteerTaskOutputSchema>;

function error(code: JobError["code"], message: string): SteerTaskOutput {
	return { ok: false, error: { code, message, retryable: false } };
}

async function resolveSteeringMessage(input: SteerTaskInput): Promise<string | SteerTaskOutput> {
	let message = input.message;
	if (input.message_file) {
		try {
			message = await readFile(resolve(input.message_file), "utf8");
		} catch (cause) {
			return error(
				"invalid_input",
				`failed to read message_file '${input.message_file}': ${cause instanceof Error ? cause.message : String(cause)}`,
			);
		}
	}
	const trimmed = message?.trim();
	if (!trimmed) return error("invalid_input", "steering message must not be empty");
	if (input.event_type !== "handoff") return message ?? trimmed;
	return `[HANDOFF]\nThe following is context transfer for this running task. Read it, summarize your understanding if useful, and continue from the current state.\n\n${message}`;
}

export async function runSteerTask(
	ctx: CommandContext,
	input: SteerTaskInput,
): Promise<SteerTaskOutput> {
	const task = getTaskById(ctx.db, input.task_id);
	if (!task) {
		return {
			ok: false,
			error: {
				code: "task_not_found",
				message: `task '${input.task_id}' not found`,
				retryable: false,
			},
		};
	}
	const adapterRes = ctx.registry.require(task.agent_kind);
	if (!adapterRes.ok) {
		return { ok: false, error: adapterRes.error };
	}
	const message = await resolveSteeringMessage(input);
	if (typeof message !== "string") return message;
	return adapterRes.value.steer({
		task_id: input.task_id,
		message,
		reason: input.reason,
	});
}
