export type TuiMode = "tasks" | "teams" | "parents";
export type TeamFocus = "list" | "members";
export type TaskDetailTab = "overview" | "events" | "output" | "context";
export type TeamDetailTab = "overview" | "members" | "attention" | "knowledge";
export type DetailTab = TaskDetailTab | TeamDetailTab;

export type TuiReturnState = {
	mode?: TuiMode;
	selected_task_id?: string;
	selected_team_id?: string;
	selected_member_task_id?: string;
	team_focus?: TeamFocus;
	task_detail_tab?: TaskDetailTab;
	team_detail_tab?: TeamDetailTab;
};

export type TuiExit =
	| { kind: "quit" }
	| { kind: "attach"; args: string[]; preAttachArgs?: string[][]; returnState?: TuiReturnState };
