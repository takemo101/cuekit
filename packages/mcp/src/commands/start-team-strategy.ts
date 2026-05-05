import {
	loadProjectConfig,
	safeAdapterOptions,
	type TeamStrategySlot,
} from "@cuekit/project-config";
import { z } from "incur";
import type { CommandContext } from "../command-context.ts";
import {
	CoordinatorBatchModeWarningSchema,
	coordinatorBatchModeWarnings,
} from "../coordinator-batch-warning.ts";
import { renderTeamStrategyPrompt, resolveTeamStrategy } from "../team-strategy.ts";
import { runCreateTeam } from "./create-team.ts";
import { runSubmitTask } from "./submit-task.ts";

const AdapterOptionsSchema = z.record(z.string(), z.unknown());

const CoordinatorObjectSchema = z
	.object({
		role: z.string().min(1).optional(),
		agent_kind: z.string().min(1).optional(),
		model: z.string().min(1).optional(),
		timeout_ms: z.union([z.number().int().positive(), z.null()]).optional(),
		adapter_options: AdapterOptionsSchema.optional(),
	})
	.strict();

const CliJsonCoordinatorSchema = z.string().transform((raw, ctx) => {
	try {
		return CoordinatorObjectSchema.parse(JSON.parse(raw));
	} catch (err) {
		ctx.addIssue({
			code: "custom",
			message: `coordinator must be a JSON object matching the expected schema: ${err instanceof Error ? err.message : String(err)}`,
		});
		return z.NEVER;
	}
});

const CoordinatorInputSchema = z.union([CoordinatorObjectSchema, CliJsonCoordinatorSchema]);

export const StartTeamStrategyInputSchema = z.object({
	strategy: z.string().min(1),
	objective: z.string().min(1),
	title: z.string().min(1).optional(),
	cwd: z.string().min(1).optional(),
	session_id: z.string().min(1).optional(),
	coordinator: CoordinatorInputSchema.optional(),
});
export type StartTeamStrategyInput = z.infer<typeof StartTeamStrategyInputSchema>;

export const StartTeamStrategyOutputSchema = z.discriminatedUnion("accepted", [
	z.object({
		accepted: z.literal(true),
		team_id: z.string(),
		coordinator_task_id: z.string(),
		strategy: z.string(),
		agent_kind: z.string(),
		role: z.string().optional(),
		model: z.string().optional(),
		warnings: z.array(CoordinatorBatchModeWarningSchema).optional(),
	}),
	z.object({
		accepted: z.literal(false),
		error: z.object({
			code: z.enum([
				"invalid_input",
				"invalid_project_config",
				"strategy_not_found",
				"team_create_failed",
				"coordinator_submit_failed",
			]),
			message: z.string(),
		}),
	}),
]);
export type StartTeamStrategyOutput = z.infer<typeof StartTeamStrategyOutputSchema>;
type StartTeamStrategyErrorCode = Extract<
	StartTeamStrategyOutput,
	{ accepted: false }
>["error"]["code"];

function failure(code: StartTeamStrategyErrorCode, message: string): StartTeamStrategyOutput {
	return { accepted: false, error: { code, message } };
}

function titleForStrategy(strategy: string, objective: string): string {
	return `${strategy}: ${objective.slice(0, 80)}`;
}

function coordinatorSlot(slot: TeamStrategySlot | undefined): TeamStrategySlot {
	return slot ?? {};
}

function resolveAdapterOptions(input: {
	caller?: Record<string, unknown>;
	strategy?: Record<string, unknown>;
	strategyDerivedExecutableField: boolean;
}): Record<string, unknown> | undefined {
	if (input.caller) return input.caller;
	if (input.strategy) return { ...input.strategy, ...safeAdapterOptions() };
	if (input.strategyDerivedExecutableField) return safeAdapterOptions();
	return undefined;
}

export async function runStartTeamStrategy(
	ctx: CommandContext,
	input: StartTeamStrategyInput,
): Promise<StartTeamStrategyOutput> {
	const parsed = StartTeamStrategyInputSchema.safeParse(input);
	if (!parsed.success) {
		return failure("invalid_input", parsed.error.issues.map((issue) => issue.message).join("; "));
	}
	input = parsed.data;

	const loaded = loadProjectConfig(input.cwd ?? process.cwd());
	if (!loaded.ok) return failure("invalid_project_config", loaded.error);
	const resolved = resolveTeamStrategy(loaded.config, input.strategy);
	if (!resolved.ok) return failure("strategy_not_found", resolved.error.message);

	const team = runCreateTeam(ctx, {
		cwd: input.cwd,
		session_id: input.session_id,
		title: input.title ?? titleForStrategy(input.strategy, input.objective),
		objective: input.objective,
		metadata: { strategy: input.strategy },
	});
	if ("error" in team) return failure("team_create_failed", team.error.message);

	const slot = coordinatorSlot(resolved.strategy.recommended_team?.coordinator);
	const role = input.coordinator?.role ?? slot.role ?? loaded.config.teams?.roles?.coordinator;
	const agent_kind = input.coordinator?.agent_kind ?? slot.agent;
	const model = input.coordinator?.model ?? slot.model;
	const projectDerivedExecutableField =
		(input.coordinator?.role === undefined &&
			(slot.role !== undefined || loaded.config.teams?.roles?.coordinator !== undefined)) ||
		(input.coordinator?.agent_kind === undefined && slot.agent !== undefined) ||
		(input.coordinator?.model === undefined && slot.model !== undefined);
	const adapter_options = resolveAdapterOptions({
		caller: input.coordinator?.adapter_options,
		strategy: slot.adapter_options,
		strategyDerivedExecutableField: projectDerivedExecutableField,
	});
	const context = renderTeamStrategyPrompt({
		strategy_name: resolved.strategy_name,
		strategy: resolved.strategy,
		objective: input.objective,
	});

	const submitted = await runSubmitTask(ctx, {
		objective: input.objective,
		cwd: input.cwd,
		session_id: team.session_id,
		team_id: team.team_id,
		position: "coordinator",
		context,
		...(role ? { role } : {}),
		...(agent_kind ? { agent_kind } : {}),
		...(model ? { model } : {}),
		...(input.coordinator?.timeout_ms !== undefined
			? { timeout_ms: input.coordinator.timeout_ms }
			: {}),
		...(adapter_options ? { adapter_options } : {}),
	});
	if (!submitted.accepted) {
		return failure("coordinator_submit_failed", submitted.error.message);
	}

	const warnings = coordinatorBatchModeWarnings({
		position: "coordinator",
		adapter_options,
	});

	return {
		accepted: true,
		team_id: team.team_id,
		coordinator_task_id: submitted.task_id,
		strategy: input.strategy,
		agent_kind: submitted.agent_kind,
		...(submitted.role ? { role: submitted.role } : {}),
		...(model ? { model } : {}),
		...(warnings ? { warnings } : {}),
	};
}
