import type {
	Ack,
	JobError,
	TaskListFilter,
	TaskStatusView,
	TaskSummary,
	TeamSummary,
	TeamTaskCounts,
} from "@cuekit/core";

export type TuiTaskEvent = {
	sequence: number;
	id: string;
	task_id: string;
	type: string;
	message: string | null;
	payload: unknown | null;
	created_at: string;
};

export type TuiTaskListOutput =
	| {
			tasks: TaskSummary[];
			has_more: boolean;
			next_cursor?: string;
	  }
	| { error: JobError };

export type TuiListTaskEventsOutput = { events: TuiTaskEvent[] } | { error: JobError };

export type TuiTeamAttentionItem = {
	sequence: number;
	task_id: string;
	position?: string;
	type: string;
	message?: string;
	message_preview?: string;
	full_message?: string;
	created_at: string;
};

export type TuiManualSteerHint = {
	attention_sequence: number;
	task_id: string;
	position?: string;
	tool: "steer_task";
	suggested_message: string;
	rationale: string;
};

export type TuiTeamStatusOutput =
	| {
			team_id: string;
			session_id?: string;
			title?: string;
			objective?: string;
			status?: string;
			task_counts?: TeamTaskCounts;
			positions?: Record<string, TaskSummary[]>;
			tasks?: TaskSummary[];
			run_summary: {
				attention_items?: TuiTeamAttentionItem[];
				manual_steer_hints?: TuiManualSteerHint[];
				open_attention?: Array<{
					task_id: string;
					position?: string;
					status: string;
					message?: string;
				}>;
			};
			cleanup_hint?: string;
	  }
	| { error: JobError };

export type TuiTeamListOutput =
	| { teams: TeamSummary[]; has_more: boolean; next_cursor?: string }
	| { error: JobError };

export type TuiTeamListInput = {
	session_id?: string;
	cwd?: string;
	project_root?: string;
	project_scope?: { project_uid?: string; project_root: string };
	project_uid?: string;
	limit?: number;
	cursor?: string;
};

export type TuiContext = {
	listTasks(input: TaskListFilter): Promise<TuiTaskListOutput>;
	listTeams?(input: TuiTeamListInput): Promise<TuiTeamListOutput>;
	getTaskStatus(taskId: string): Promise<TaskStatusView>;
	getTeamStatus?(teamId: string): Promise<TuiTeamStatusOutput>;
	listTaskEvents(taskId: string): Promise<TuiListTaskEventsOutput>;
	cancelTask(taskId: string): Promise<Ack>;
	deleteTask(taskId: string): Promise<Ack>;
	steerTask(taskId: string, message: string): Promise<Ack>;
	cleanupTeam?(teamId: string): Promise<Ack>;
	deleteTeam?(teamId: string): Promise<Ack>;
	getTranscriptPath?(taskId: string): string | undefined;
	/** Capture the rendered screen for a running task via the configured
	 * multiplexer backend. When absent, the TUI falls back to the legacy
	 * tmux-only capture path during the compatibility window. */
	capturePane?(taskId: string): Promise<string | null>;
};
