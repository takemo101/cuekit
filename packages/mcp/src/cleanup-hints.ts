function taskCleanupHint(taskIds: string[]): string {
	return `Terminal task(s) can be removed by calling the cuekit_delete MCP tool with kind="tasks" and task_ids=${JSON.stringify(taskIds)} when no longer needed.`;
}

export function cleanupHintForTaskIds(taskIds: string[]): string | undefined {
	if (taskIds.length === 0) return undefined;
	return taskCleanupHint(taskIds);
}

export function cleanupHintForTaskId(taskId: string): string {
	return taskCleanupHint([taskId]);
}

export function cleanupHintForTeam(teamId: string, terminalTaskCount: number): string | undefined {
	if (terminalTaskCount === 0) return undefined;
	return `Terminal team task(s) can be removed by calling the cuekit_cleanup MCP tool with kind="team" and team_id="${teamId}" when no longer needed.`;
}
