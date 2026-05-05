import type { Ack, JobError, TaskListFilter, TaskStatusView, TaskSummary } from "@cuekit/core";

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
			run_summary: {
				attention_items?: TuiTeamAttentionItem[];
				manual_steer_hints?: TuiManualSteerHint[];
			};
	  }
	| { error: JobError };

export type TuiContext = {
	listTasks(input: TaskListFilter): Promise<TuiTaskListOutput>;
	getTaskStatus(taskId: string): Promise<TaskStatusView>;
	getTeamStatus?(teamId: string): Promise<TuiTeamStatusOutput>;
	listTaskEvents(taskId: string): Promise<TuiListTaskEventsOutput>;
	cancelTask(taskId: string): Promise<Ack>;
	deleteTask(taskId: string): Promise<Ack>;
	steerTask(taskId: string, message: string): Promise<Ack>;
	getTranscriptPath?(taskId: string): string | undefined;
};
