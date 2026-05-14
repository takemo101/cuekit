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
	reason?: string;
	message?: string;
	message_preview?: string;
	full_message?: string;
	created_at: string;
};

export type TuiManualSteerHint = {
	attention_sequence: number;
	task_id: string;
	position?: string;
	tool: "steer";
	suggested_message: string;
	rationale: string;
};

export type TuiTeamBlackboardEvent = {
	sequence: number;
	event_id: string;
	task_id?: string;
	position?: string;
	event_type: string;
	message: string;
	payload?: unknown;
	created_at: string;
};

export type TuiTeamHandoff = {
	task_id: string;
	position?: string;
	event_id: string;
	sequence: number;
	message_preview?: string;
	artifact_path?: string;
	created_at: string;
};

export type TuiTeamBlocker = {
	task_id: string;
	position?: string;
	message: string;
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

export type TuiTeamSnapshotGuidance = {
	recommended_next_reads?: string[];
	manual_steer_hints?: TuiManualSteerHint[];
	suggested_next_actions?: string[];
};

export type TuiTeamSnapshotOutput =
	| {
			team_id: string;
			session_id: string;
			title: string;
			objective?: string;
			status: string;
			task_counts: TeamTaskCounts;
			generated_at: string;
			members: Array<{
				task_id: string;
				position?: string;
				role?: string;
				agent_kind: string;
				model?: string;
				status: TaskSummary["status"];
				summary?: string;
				updated_at: string;
			}>;
			positions: Record<string, unknown>;
			recent_events: unknown[];
			attention_items?: TuiTeamAttentionItem[];
			manual_steer_hints?: TuiManualSteerHint[];
			latest_handoffs: TuiTeamHandoff[];
			blackboard_events: TuiTeamBlackboardEvent[];
			blockers?: TuiTeamBlocker[];
			guidance: TuiTeamSnapshotGuidance;
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

export type TuiTaskListInput = TaskListFilter & {
	/** UI-only list policy: false keeps high-frequency list refreshes on persisted rows. */
	refresh_status?: boolean;
};

export type TuiContext = {
	detailLoadDebounceMs?: number;
	listTasks(input: TuiTaskListInput): Promise<TuiTaskListOutput>;
	listTeams?(input: TuiTeamListInput): Promise<TuiTeamListOutput>;
	getTaskStatus(taskId: string): Promise<TaskStatusView>;
	getTeamStatus?(teamId: string): Promise<TuiTeamStatusOutput>;
	getTeamSnapshot?(teamId: string): Promise<TuiTeamSnapshotOutput>;
	listTaskEvents(taskId: string): Promise<TuiListTaskEventsOutput>;
	cancelTask(taskId: string): Promise<Ack>;
	deleteTask(taskId: string): Promise<Ack>;
	steerTask(taskId: string, message: string): Promise<Ack>;
	createParentSession?(input?: {
		objective?: string;
		cwd?: string;
	}): Promise<{ task_id: string } | { error: JobError }>;
	cleanupTeam?(teamId: string): Promise<Ack>;
	deleteTeam?(teamId: string): Promise<Ack>;
	getTranscriptPath?(taskId: string): string | undefined;
	/** Capture the rendered screen for a running task via the configured
	 * multiplexer backend. When absent, the TUI falls back to the legacy
	 * tmux-only capture path during the compatibility window. */
	capturePane?(taskId: string): Promise<string | null>;
};
