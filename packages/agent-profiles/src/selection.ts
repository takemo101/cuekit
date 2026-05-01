import type { ResolvedAgentProfile } from "./schema.ts";

export interface SelectAgentProfileInput {
	objective: string;
	context?: string;
	profiles: ResolvedAgentProfile[];
}

export interface SelectAgentProfileResult {
	profile: ResolvedAgentProfile;
	reason: string;
}

const RULES: Array<{ id: string; keywords: string[]; reason: string }> = [
	{
		id: "reviewer",
		keywords: ["review", "diff", "pr", "pull request", "code review"],
		reason: "matched review/diff/PR keywords",
	},
	{
		id: "planner",
		keywords: ["plan", "design", "spec", "architecture", "proposal"],
		reason: "matched plan/design/spec keywords",
	},
	{
		id: "debugger",
		keywords: ["bug", "debug", "failing", "failure", "test failure", "broken", "error"],
		reason: "matched bug/debug/failing keywords",
	},
	{
		id: "docs-writer",
		keywords: ["docs", "documentation", "readme", "changelog", "guide"],
		reason: "matched docs/README/changelog keywords",
	},
	{
		id: "scout",
		keywords: ["inspect", "explore", "understand", "map", "investigate", "survey"],
		reason: "matched inspect/explore/understand keywords",
	},
];

function profileById(
	profiles: ResolvedAgentProfile[],
	id: string,
): ResolvedAgentProfile | undefined {
	return profiles.find((profile) => profile.id === id);
}

function matchesKeyword(haystack: string, keyword: string): boolean {
	const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`\\b${escaped}\\b`).test(haystack);
}

function fallbackProfile(
	profiles: ResolvedAgentProfile[],
	reasonPrefix = "defaulted",
): SelectAgentProfileResult | undefined {
	const worker = profileById(profiles, "worker");
	if (worker) return { profile: worker, reason: `${reasonPrefix} to worker fallback` };
	const first = [...profiles].sort((a, b) => a.id.localeCompare(b.id))[0];
	if (!first) return undefined;
	return { profile: first, reason: `${reasonPrefix} to first available profile '${first.id}'` };
}

export function selectAgentProfile(
	input: SelectAgentProfileInput,
): SelectAgentProfileResult | undefined {
	const haystack = `${input.objective}\n${input.context ?? ""}`.toLowerCase();
	for (const rule of RULES) {
		if (!rule.keywords.some((keyword) => matchesKeyword(haystack, keyword))) continue;
		const profile = profileById(input.profiles, rule.id);
		if (profile) return { profile, reason: rule.reason };
		return fallbackProfile(
			input.profiles,
			`matched ${rule.id} keywords but profile missing; defaulted`,
		);
	}
	return fallbackProfile(input.profiles);
}
