import { isAbsolute, relative, resolve, sep } from "node:path";
import { JobErrorSchema, TeamPositionSchema } from "@cuekit/core";
import {
	applyTeamRoleDefault,
	loadProjectConfig,
	safeAdapterOptions,
} from "@cuekit/project-config";
import { getSessionById, getTaskById, getTaskTeamById } from "@cuekit/store";
import { z } from "incur";
import type { CommandContext } from "../command-context.ts";
import { runSubmitTask, SubmitTaskInputSchema } from "./submit-task.ts";

export const SubmitTeamTaskItemSchema = SubmitTaskInputSchema.omit({
	session_id: true,
	team_id: true,
});

export const SubmitTeamTasksInputSchema = z.object({
	team_id: z.string().min(1),
	tasks: z.array(z.unknown()).min(1),
});

export type SubmitTeamTasksInput = z.infer<typeof SubmitTeamTasksInputSchema>;

const AcceptedTeamTaskSchema = z.object({
	index: z.number().int().nonnegative(),
	task_id: z.string(),
	agent_kind: z.string(),
	role: z.string().optional(),
	position: TeamPositionSchema.optional(),
	model: z.string().optional(),
});

const RejectedTeamTaskSchema = z.object({
	index: z.number().int().nonnegative(),
	error: JobErrorSchema,
});

export const SubmitTeamTasksOutputSchema = z.union([
	z.object({
		team_id: z.string(),
		accepted: z.array(AcceptedTeamTaskSchema),
		rejected: z.array(RejectedTeamTaskSchema),
	}),
	z.object({ error: JobErrorSchema }),
]);

export type SubmitTeamTasksOutput = z.infer<typeof SubmitTeamTasksOutputSchema>;

function commandError(
	code: z.infer<typeof JobErrorSchema>["code"],
	message: string,
): SubmitTeamTasksOutput {
	return { error: { code, message, retryable: false } };
}

function taskError(
	index: number,
	code: z.infer<typeof JobErrorSchema>["code"],
	message: string,
): z.infer<typeof RejectedTeamTaskSchema> {
	return { index, error: { code, message, retryable: false } };
}

function formatTaskIssues(index: number, issues: z.core.$ZodIssue[]): string {
	return issues
		.map((issue) => {
			const path = issue.path.length > 0 ? `.${issue.path.join(".")}` : "";
			return `tasks[${index}]${path}: ${issue.message}`;
		})
		.join("; ");
}

function isSameOrInsidePath(candidate: string, root: string): boolean {
	const resolvedCandidate = resolve(candidate);
	const resolvedRoot = resolve(root);
	const rel = relative(resolvedRoot, resolvedCandidate);
	return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

export async function runSubmitTeamTasks(
	ctx: CommandContext,
	input: SubmitTeamTasksInput,
): Promise<SubmitTeamTasksOutput> {
	const parsed = SubmitTeamTasksInputSchema.safeParse(input);
	if (!parsed.success) {
		return commandError(
			"invalid_input",
			parsed.error.issues.map((issue) => issue.message).join("; "),
		);
	}
	const team = getTaskTeamById(ctx.db, parsed.data.team_id);
	if (!team) return commandError("team_not_found", `team '${parsed.data.team_id}' not found`);
	const session = getSessionById(ctx.db, team.session_id);
	if (!session) return commandError("session_not_found", `session '${team.session_id}' not found`);

	const loadedConfig = loadProjectConfig(session.worktree_path);
	if (!loadedConfig.ok) return commandError("invalid_input", loadedConfig.error);
	const accepted: z.infer<typeof AcceptedTeamTaskSchema>[] = [];
	const rejected: z.infer<typeof RejectedTeamTaskSchema>[] = [];
	for (const [index, rawTask] of parsed.data.tasks.entries()) {
		const parsedTask = SubmitTeamTaskItemSchema.safeParse(rawTask);
		if (!parsedTask.success) {
			rejected.push(
				taskError(index, "invalid_input", formatTaskIssues(index, parsedTask.error.issues)),
			);
			continue;
		}
		const task = parsedTask.data;
		if (task.cwd !== undefined && !isSameOrInsidePath(task.cwd, session.worktree_path)) {
			rejected.push(
				taskError(
					index,
					"invalid_input",
					`task cwd '${resolve(task.cwd)}' is outside team session '${team.session_id}' worktree '${resolve(session.worktree_path)}'`,
				),
			);
			continue;
		}
		const roleDefault = applyTeamRoleDefault(task, loadedConfig.config);
		const effectiveTask = {
			...task,
			...(roleDefault.role ? { role: roleDefault.role } : {}),
			...(roleDefault.role_from_team_config && task.adapter_options === undefined
				? { adapter_options: safeAdapterOptions() }
				: {}),
		};
		const result = await runSubmitTask(ctx, {
			...effectiveTask,
			session_id: team.session_id,
			team_id: team.id,
		});
		if (result.accepted) {
			const createdTask = getTaskById(ctx.db, result.task_id);
			accepted.push({
				index,
				task_id: result.task_id,
				agent_kind: result.agent_kind,
				...(result.role ? { role: result.role } : {}),
				...(result.position ? { position: result.position } : {}),
				...(createdTask?.model ? { model: createdTask.model } : {}),
			});
		} else {
			rejected.push({ index, error: result.error });
		}
	}
	return { team_id: team.id, accepted, rejected };
}
