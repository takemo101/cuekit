import {
	type ArtifactRef,
	isTerminalTaskStatus,
	type TaskResult,
	type TerminalTaskResultStatus,
} from "@cuekit/core";
import type { Task } from "@cuekit/store";

// Converts a persisted Task row into the protocol-level TaskResult shape.
// Raw runtime output parsing (file_changed inference, rich artifact
// discovery) is NOT done here in v0 — that belongs to per-adapter
// extraction logic. This normalizer handles the minimum every adapter
// shares: status, summary, transcript + result_ref wiring.
export function normalizeTaskResult(task: Task): TaskResult {
	if (!isTerminalTaskStatus(task.status)) {
		// Defect: callers must check ensureCollectable first.
		throw new Error(`defect: cannot normalize non-terminal task status '${task.status}'`);
	}
	const artifacts: ArtifactRef[] = [];
	if (task.transcript_ref) {
		artifacts.push({ kind: "transcript", ref: task.transcript_ref });
	}
	if (task.result_ref) {
		artifacts.push({ kind: "json", ref: task.result_ref });
	}
	return {
		task_id: task.id,
		status: task.status as TerminalTaskResultStatus,
		summary: task.summary ?? "",
		files_changed: [],
		artifacts,
	};
}
