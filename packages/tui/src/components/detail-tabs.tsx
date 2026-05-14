import type { DetailTab, TaskDetailTab, TeamDetailTab, TuiMode } from "../tui-state.ts";

export type DetailTabDefinition<T extends DetailTab = DetailTab> = {
	id: T;
	label: string;
};

export const TASK_DETAIL_TABS = [
	{ id: "overview", label: "Overview" },
	{ id: "events", label: "Events" },
	{ id: "output", label: "Output" },
	{ id: "context", label: "Context" },
] as const satisfies readonly DetailTabDefinition<TaskDetailTab>[];

export const TEAM_DETAIL_TABS = [
	{ id: "overview", label: "Overview" },
	{ id: "members", label: "Members" },
	{ id: "attention", label: "Attention" },
	{ id: "knowledge", label: "Knowledge" },
] as const satisfies readonly DetailTabDefinition<TeamDetailTab>[];

export function detailTabsForMode(mode: TuiMode): readonly DetailTabDefinition[] {
	return mode === "teams" ? TEAM_DETAIL_TABS : TASK_DETAIL_TABS;
}

export function nextDetailTab<T extends DetailTab>(
	current: string | undefined,
	tabs: readonly DetailTabDefinition<T>[],
	delta: 1 | -1,
): T {
	const currentIndex = tabs.findIndex((tab) => tab.id === current);
	const fallback = (tabs[0]?.id ?? "overview") as T;
	if (currentIndex < 0) return fallback;
	const nextIndex = (currentIndex + delta + tabs.length) % tabs.length;
	return tabs[nextIndex]?.id ?? fallback;
}

export function safeDetailTabForMode(mode: TuiMode, requested: string | undefined): DetailTab {
	const tabs = detailTabsForMode(mode);
	return tabs.find((tab) => tab.id === requested)?.id ?? tabs[0]?.id ?? "overview";
}

export function detailTabHintLabel<T extends DetailTab>(
	tabs: readonly DetailTabDefinition<T>[],
	active: T,
): string {
	const labels = tabs
		.map((tab) => (tab.id === active ? `${tab.label}*` : tab.label))
		.join(" | ");
	return `Tab/Shift+Tab: ${labels}`;
}
