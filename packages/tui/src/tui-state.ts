export type TuiMode = "tasks" | "teams";
export type TeamFocus = "list" | "members";

export type TuiReturnState = {
	mode?: TuiMode;
	selected_task_id?: string;
	selected_team_id?: string;
	selected_member_task_id?: string;
	team_focus?: TeamFocus;
};

export type TuiExit =
	| { kind: "quit" }
	| { kind: "attach"; args: string[]; returnState?: TuiReturnState };
