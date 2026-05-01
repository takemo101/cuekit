import type { Database } from "bun:sqlite";
import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import { isTerminalTaskStatus, type TaskStatusView } from "@cuekit/core";
import { listTaskEvents, type Task } from "@cuekit/store";

const NO_RECENT_ACTIVITY_MS = 60_000;
const TRANSCRIPT_TAIL_BYTES = 64 * 1024;

export type TaskActivity = Pick<
	TaskStatusView,
	"last_event_at" | "last_transcript_at" | "idle_ms" | "attention_hint"
>;

function latestIso(values: Array<string | undefined>): string | undefined {
	let latest: string | undefined;
	let latestMs = Number.NEGATIVE_INFINITY;
	for (const value of values) {
		if (!value) continue;
		const ms = Date.parse(value);
		if (!Number.isFinite(ms)) continue;
		if (ms > latestMs) {
			latest = value;
			latestMs = ms;
		}
	}
	return latest;
}

function transcriptMtime(path: string | null): string | undefined {
	if (!path || !existsSync(path)) return undefined;
	try {
		return statSync(path).mtime.toISOString();
	} catch {
		return undefined;
	}
}

function readTranscriptTail(path: string): string {
	let fd: number | undefined;
	try {
		const stat = statSync(path);
		const bytesToRead = Math.min(stat.size, TRANSCRIPT_TAIL_BYTES);
		const start = Math.max(0, stat.size - bytesToRead);
		const buffer = Buffer.alloc(bytesToRead);
		fd = openSync(path, "r");
		readSync(fd, buffer, 0, bytesToRead, start);
		return buffer.toString("utf8");
	} catch {
		return "";
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}

function transcriptSuggestsAttention(path: string | null): boolean {
	if (!path || !existsSync(path)) return false;
	const text = readTranscriptTail(path).toLowerCase();
	return text.includes("stop hook prevented continuation") || text.includes("idle-prompt");
}

export function getTaskActivity(db: Database, task: Task, nowMs = Date.now()): TaskActivity {
	const events = listTaskEvents(db, task.id);
	const lastEventAt = events.at(-1)?.created_at;
	const lastTranscriptAt = transcriptMtime(task.transcript_ref);
	const lastActivityAt = latestIso([
		lastEventAt,
		lastTranscriptAt,
		task.updated_at,
		task.started_at ?? undefined,
	]);
	const lastActivityMs = lastActivityAt ? Date.parse(lastActivityAt) : NaN;
	const idleMs = Number.isFinite(lastActivityMs) ? Math.max(0, nowMs - lastActivityMs) : undefined;
	const attention_hint = isTerminalTaskStatus(task.status)
		? undefined
		: transcriptSuggestsAttention(task.transcript_ref)
			? "stop_hook_or_idle_prompt_suspected"
			: idleMs !== undefined && idleMs >= NO_RECENT_ACTIVITY_MS
				? "no_recent_activity"
				: undefined;
	return {
		...(lastEventAt ? { last_event_at: lastEventAt } : {}),
		...(lastTranscriptAt ? { last_transcript_at: lastTranscriptAt } : {}),
		...(idleMs !== undefined ? { idle_ms: idleMs } : {}),
		...(attention_hint ? { attention_hint } : {}),
	};
}
