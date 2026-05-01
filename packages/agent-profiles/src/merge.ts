import type { AgentProfileFile, AgentProfileSource, ResolvedAgentProfile } from "./schema.ts";

export type MergeAgentProfilesResult =
	| { ok: true; profiles: ResolvedAgentProfile[] }
	| { ok: false; error: string };

const SOURCE_ORDER: AgentProfileSource[] = ["builtin", "user", "project"];

function sourceRank(source: AgentProfileSource): number {
	return SOURCE_ORDER.indexOf(source);
}

function sourcePath(profile: AgentProfileFile): string {
	return profile.file_path ?? `${profile.source}:${profile.id}`;
}

function validateSameScopeDuplicates(profiles: AgentProfileFile[]): string | null {
	const seen = new Map<string, AgentProfileFile>();
	for (const profile of [...profiles].sort((a, b) => sourcePath(a).localeCompare(sourcePath(b)))) {
		const key = `${profile.source}:${profile.id}`;
		const previous = seen.get(key);
		if (previous) {
			return `duplicate agent profile id '${profile.id}' in ${profile.source} scope: ${sourcePath(previous)}, ${sourcePath(profile)}`;
		}
		seen.set(key, profile);
	}
	return null;
}

function appendInstructions(base: string, addition: string): string {
	if (!base) return addition;
	if (!addition) return base;
	return `${base}\n\n---\n\n${addition}`;
}

function mergeOne(
	base: ResolvedAgentProfile | undefined,
	override: AgentProfileFile,
): ResolvedAgentProfile {
	const body = override.instructions.trim();
	const instructionsMode = override.instructions_mode ?? "replace";
	const instructions =
		body.length === 0
			? (base?.instructions ?? "")
			: instructionsMode === "append"
				? appendInstructions(base?.instructions ?? "", body)
				: body;
	const sources = Array.from(new Set([...(base?.sources ?? []), override.source])).sort(
		(a, b) => sourceRank(a) - sourceRank(b),
	);
	return {
		id: override.id,
		description: override.description ?? base?.description ?? "",
		agent_kind: override.agent_kind ?? base?.agent_kind,
		model: override.model ?? base?.model,
		tags: override.tags ?? base?.tags ?? [],
		instructions,
		instructions_mode: instructionsMode,
		source: sources[sources.length - 1] ?? override.source,
		sources,
		file_paths: [...(base?.file_paths ?? []), ...(override.file_path ? [override.file_path] : [])],
	};
}

export function mergeAgentProfiles(profiles: AgentProfileFile[]): MergeAgentProfilesResult {
	const duplicateError = validateSameScopeDuplicates(profiles);
	if (duplicateError) return { ok: false, error: duplicateError };
	const byId = new Map<string, ResolvedAgentProfile>();
	const ordered = [...profiles].sort((a, b) => {
		const rank = sourceRank(a.source) - sourceRank(b.source);
		return rank !== 0 ? rank : sourcePath(a).localeCompare(sourcePath(b));
	});
	for (const profile of ordered) {
		byId.set(profile.id, mergeOne(byId.get(profile.id), profile));
	}
	const resolved = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
	const invalid = resolved.find(
		(profile) => profile.description.length === 0 || profile.instructions.length === 0,
	);
	if (invalid) {
		return {
			ok: false,
			error: `agent profile '${invalid.id}' is missing required resolved fields`,
		};
	}
	return { ok: true, profiles: resolved };
}
