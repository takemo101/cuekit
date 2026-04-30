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

export type TuiContext = {
	listTasks(input: TaskListFilter): Promise<TuiTaskListOutput>;
	getTaskStatus(taskId: string): Promise<TaskStatusView>;
	listTaskEvents(taskId: string): Promise<TuiListTaskEventsOutput>;
	cancelTask(taskId: string): Promise<Ack>;
	deleteTask(taskId: string): Promise<Ack>;
	steerTask(taskId: string, message: string): Promise<Ack>;
	getTranscriptPath?(taskId: string): string | undefined;
};
