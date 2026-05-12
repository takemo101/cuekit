import { HookDispatcher } from "@cuekit/adapters";
import { isTerminalTaskStatus } from "@cuekit/core";
import { getTaskTeamById, listTasksByTeam, type TaskTeamRow } from "@cuekit/store";
import type { CommandContext } from "./command-context.ts";

const HOOK_METADATA_KEY = "hooks";
const MAX_MARK_ATTEMPTS = 5;

type HookMetadata = Record<string, unknown> & {
	on_team_start?: boolean;
	on_team_complete?: boolean;
};

function parseMetadata(metadataJson: string | null): Record<string, unknown> {
	if (!metadataJson) return {};
	try {
		const parsed = JSON.parse(metadataJson) as unknown;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

function hookMetadata(metadata: Record<string, unknown>): HookMetadata {
	const existing = metadata[HOOK_METADATA_KEY];
	return existing && typeof existing === "object" && !Array.isArray(existing)
		? { ...(existing as HookMetadata) }
		: {};
}

function markTeamHookFired(ctx: CommandContext, teamId: string, key: keyof HookMetadata): boolean {
	for (let attempt = 0; attempt < MAX_MARK_ATTEMPTS; attempt++) {
		const team = getTaskTeamById(ctx.db, teamId);
		if (!team) return false;
		const metadata = parseMetadata(team.metadata_json);
		const hooks = hookMetadata(metadata);
		if (hooks[key] === true) return false;
		hooks[key] = true;
		const nextMetadata = JSON.stringify({ ...metadata, [HOOK_METADATA_KEY]: hooks });
		const now = new Date().toISOString();
		const result = team.metadata_json
			? ctx.db
					.prepare(
						"update task_teams set metadata_json = ?, updated_at = ? where id = ? and metadata_json = ?",
					)
					.run(nextMetadata, now, team.id, team.metadata_json)
			: ctx.db
					.prepare(
						"update task_teams set metadata_json = ?, updated_at = ? where id = ? and metadata_json is null",
					)
					.run(nextMetadata, now, team.id);
		if (result.changes > 0) return true;
	}
	return false;
}

function fireTeamHook(
	ctx: CommandContext,
	team: TaskTeamRow,
	event: "on_team_start" | "on_team_complete",
) {
	if (!ctx.hooks) return;
	const env = HookDispatcher.teamEnv(team);
	env.CUEKIT_EVENT = event;
	ctx.hooks.fire(event, env);
}

export function fireTeamStartHookOnce(ctx: CommandContext, teamId: string): void {
	if (!ctx.hooks) return;
	if (!markTeamHookFired(ctx, teamId, "on_team_start")) return;
	const team = getTaskTeamById(ctx.db, teamId);
	if (!team) return;
	fireTeamHook(ctx, team, "on_team_start");
}

export function fireTeamCompleteHookIfDone(ctx: CommandContext, teamId: string): void {
	if (!ctx.hooks) return;
	const team = getTaskTeamById(ctx.db, teamId);
	if (!team) return;
	const tasks = listTasksByTeam(ctx.db, team.id);
	if (tasks.length === 0 || !tasks.every((task) => isTerminalTaskStatus(task.status))) return;
	if (!markTeamHookFired(ctx, team.id, "on_team_complete")) return;
	const updated = getTaskTeamById(ctx.db, team.id) ?? team;
	fireTeamHook(ctx, updated, "on_team_complete");
}
